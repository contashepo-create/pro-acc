/**
 * Whole-UI wiring guard (no browser required).
 *
 * The previous audit round found two classes of dead controls that TypeScript
 * cannot catch: buttons without any handler, and links/forms pointing at
 * endpoints that do not exist (a header search that 404'd, a setup page that
 * called a renamed API path, a panel logo linking to a route without a page).
 * This suite pins the wiring invariants across EVERY page so a regression
 * fails CI instead of shipping a dead button:
 *
 *  1. every <form> must declare onSubmit (or an HTML action),
 *  2. every <Button>/<button> must be actionable: onClick, type="submit",
 *     asChild, disabled, an inline <a href> wrapper, or a raw-HTML print
 *     button inside a document.write window,
 *  3. no empty onClick handlers,
 *  4. every literal fetch('/api/…') path must resolve to an existing route,
 *  5. every literal internal href/router.push path must resolve to a page.
 */
import fs from 'fs';
import path from 'path';

const appDir = path.resolve(__dirname, '../../src/app');

function listFiles(dir: string, ext = '.tsx'): string[] {
  const out: string[] = [];
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) out.push(...listFiles(full, ext));
    else if (entry.name.endsWith(ext)) out.push(full.replace(/\\/g, '/'));
  }
  return out;
}

/** Read the full JSX open tag starting at `start`, tracking {} nesting. */
function openTag(src: string, start: number): string {
  let depth = 0;
  for (let i = start; i < src.length; i++) {
    const ch = src[i];
    if (ch === '{') depth++;
    else if (ch === '}') depth--;
    else if (ch === '>' && depth === 0) return src.slice(start, i + 1);
  }
  return src.slice(start, start + 400);
}

const uiFiles = [
  ...listFiles(path.join(appDir, '(dashboard)')),
  ...listFiles(path.join(appDir, '(auth)')),
  ...listFiles(path.join(appDir, 'zerocold')),
  ...listFiles(path.join(appDir, 'portal')),
];

/** Pages that exist (path → set with [id] normalised to PARAM). */
function collectPages(): Set<string> {
  const pages = new Set<string>();
  for (const file of listFiles(appDir)) {
    if (!file.endsWith('page.tsx')) continue;
    const rel = file.slice(appDir.length + 1).replace(/\/page\.tsx$/, '')
      .replace(/\(dashboard\)\//, '').replace(/\(auth\)\//, '');
    pages.add(rel);
  }
  return pages;
}

function collectApiRoutes(): Set<string> {
  const routes = new Set<string>();
  for (const file of listFiles(appDir, '.ts')) {
    if (!file.endsWith('route.ts')) continue;
    const rel = file.slice(appDir.length + 1).replace(/\/route\.ts$/, '');
    if (rel.startsWith('api/')) routes.add(rel);
  }
  return routes;
}

function normalizeDynamic(p: string): string {
  return p
    .replace(/\[[^\]]+\]/g, 'PARAM')
    .replace(/\$\{[^}]*\}/g, 'PARAM')
    .replace(/[?#].*$/, '')
    .replace(/^\/+|\/+$/g, '');
}

describe('UI wiring: forms and buttons', () => {
  test('every form declares onSubmit', () => {
    const offenders: string[] = [];
    for (const file of uiFiles) {
      const src = fs.readFileSync(file, 'utf8');
      for (const match of src.matchAll(/<form\b/g)) {
        const tag = openTag(src, match.index);
        if (!/onSubmit\s*=/.test(tag) && !/\baction\s*=/.test(tag)) {
          offenders.push(`${file.slice(appDir.length + 1)}:${src.slice(0, match.index).split('\n').length}`);
        }
      }
    }
    expect(offenders).toEqual([]);
    expect(uiFiles.length).toBeGreaterThan(80);
  });

  test('every button is actionable', () => {
    const offenders: string[] = [];
    for (const file of uiFiles) {
      const src = fs.readFileSync(file, 'utf8');
      for (const match of src.matchAll(/<(Button|button)\b/g)) {
        const tag = openTag(src, match.index);
        const actionable =
          /onClick\s*=|type\s*=\s*["']submit["']|asChild|\bdisabled\b/.test(tag)
          // raw-HTML print buttons inside document.write windows use lowercase onclick
          || /onclick\s*=/.test(tag)
          // a link-button: an unclosed <a href> opened before this button
          || src.lastIndexOf('<a', match.index) > src.lastIndexOf('</a>', match.index);
        if (!actionable) {
          offenders.push(`${file.slice(appDir.length + 1)}:${src.slice(0, match.index).split('\n').length}: ${tag.slice(0, 80).replace(/\s+/g, ' ')}`);
        }
      }
    }
    expect(offenders).toEqual([]);
  });

  test('no empty onClick handlers', () => {
    const offenders: string[] = [];
    for (const file of uiFiles) {
      const src = fs.readFileSync(file, 'utf8');
      if (/onClick\s*=\s*\{\s*(\(\)|\([^)]*\))\s*=>\s*\{\s*\}\s*\}/.test(src)) {
        offenders.push(file.slice(appDir.length + 1));
      }
    }
    expect(offenders).toEqual([]);
  });
});

describe('UI wiring: endpoints exist', () => {
  const apiRoutes = collectApiRoutes();
  const pages = collectPages();

  test('every literal fetch path resolves to an API route', () => {
    const offenders: string[] = [];
    for (const file of uiFiles) {
      const src = fs.readFileSync(file, 'utf8');
      for (const match of src.matchAll(/fetch\(\s*[`'"]([^`'"$]*\/api\/[^`'"$]*)[`'"]/g)) {
        const route = normalizeDynamic(match[1].replace(/^\/api\//, ''));
        const resolved = [...apiRoutes].some((r) => normalizeDynamic(r.replace(/^api\//, '')) === route);
        if (!resolved) offenders.push(`${file.slice(appDir.length + 1)} → ${match[1]}`);
      }
    }
    expect(offenders).toEqual([]);
  });

  test('every literal internal link resolves to a page', () => {
    const offenders: string[] = [];
    const seen = new Set<string>();
    for (const file of uiFiles) {
      const src = fs.readFileSync(file, 'utf8');
      const patterns = [
        /href\s*=\s*[`'"]([^`'"$][^`'"]*)[`'"]/g,
        /(?:router|useRouter\(\))\s*\.\s*(?:push|replace)\s*\(\s*[`'"]([^`'"$][^`'"]*)[`'"]/g,
      ];
      for (const re of patterns) {
        for (const match of src.matchAll(re)) {
          const target = match[1];
          if (!target.startsWith('/')) continue;
          if (target.startsWith('/api/') || /^(https?:|#|javascript:|mailto:|tel:)/.test(target)) continue;
          const route = normalizeDynamic(target);
          const resolved = route === '' || pages.has(route)
            || [...pages].some((p) => normalizeDynamic(p) === route);
          if (!resolved && !seen.has(route)) {
            seen.add(route);
            offenders.push(`${file.slice(appDir.length + 1)} → ${target}`);
          }
        }
      }
    }
    expect(offenders).toEqual([]);
  });
});
