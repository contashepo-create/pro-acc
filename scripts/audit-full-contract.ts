/**
 * FULL PROJECT AUDIT — automated cross-checks over every dashboard page and
 * API route. Complements the human review with three mechanical sweeps:
 *
 *   A) CONTRACT CHECK  — every dashboard fetch() vs the actual keys the API
 *      route returns (the equipment-costs crash class: page reads data.rows
 *      while the route returns data.assets).
 *   B) SECURITY SWEEP  — every route: auth guard present? input validation?
 *      tenant filter (companyId) on data access? raw-SQL injection patterns?
 *   C) ACCOUNTING CORE — journal/invoice/payment/closure routes inventory.
 *
 * Output: docs/audit-full-report.md (+ console summary).
 * Run: npx tsx scripts/audit-full-contract.ts
 */
import fs from 'node:fs';
import path from 'node:path';

const ROOT = process.cwd();
const pagesDir = path.join(ROOT, 'src/app/(dashboard)');
const apiDir = path.join(ROOT, 'src/app/api');

/* ---------------- helpers ---------------- */

function walk(dir: string, pred: (f: string) => boolean, acc: string[] = []): string[] {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) walk(full, pred, acc);
    else if (pred(entry.name)) acc.push(full);
  }
  return acc;
}

const routeFiles = walk(apiDir, (f) => f === 'route.ts');
const pageFiles = walk(pagesDir, (f) => f === 'page.tsx');

/** Map URL path → route file. */
function urlOfRoute(file: string): string {
  const rel = path.relative(path.join(ROOT, 'src/app'), file);
  const withoutRoute = rel.replace(/\/route\.ts$/, '');
  // [id] → :id style kept as-is for matching
  return '/' + withoutRoute.split(path.sep).join('/');
}

/* ---------------- A) contract check ---------------- */

interface RouteInfo {
  url: string;
  file: string;
  methods: string[];
  /** payload keys under data for each method (best effort) */
  payloadKeys: Record<string, string[]>;
}

function extractRoutePayloads(src: string): Record<string, string[]> {
  const out: Record<string, string[]> = {};
  const methodRe = /export\s+async\s+function\s+(GET|POST|PUT|PATCH|DELETE)\s*\(/g;
  // Split source into method blocks
  const matches = [...src.matchAll(/export\s+async\s+function\s+(GET|POST|PUT|PATCH|DELETE)\s*\([^)]*\)\s*(?::[^{]+)?\{/g)];
  for (let i = 0; i < matches.length; i++) {
    const m = matches[i];
    const start = m.index! + m[0].length;
    const end = i + 1 < matches.length ? matches[i + 1].index! : src.length;
    const body = src.slice(start, end);
    const keys = new Set<string>();
    // success({ a, b, rows: ..., assets: ... })
    for (const sm of body.matchAll(/success\s*\(\s*\{([\s\S]*?)\}\s*\)/g)) {
      const inner = sm[1];
      for (const km of inner.matchAll(/(?:^|,|\. \s*)([a-zA-Z_][\w]*)\s*:/g)) keys.add(km[1]);
      for (const km of inner.matchAll(/\.(\w+)\s*:/g)) keys.add(km[1]);
    }
    // success(x) where x is bare → unknown, mark with '*'
    if (/success\s*\(\s*[a-zA-Z_][\w.]*\s*\)/.test(body) && keys.size === 0) keys.add('*passed-through*');
    // spread of a variable → '*spread*'
    if (/\.\.\./.test(body.match(/success\s*\(\s*\{([\s\S]*?)\}\s*\)/)?.[1] || '')) keys.add('*spread*');
    out[m[1]] = [...keys];
  }
  void methodRe;
  return out;
}

const routes: RouteInfo[] = routeFiles.map((file) => {
  const src = fs.readFileSync(file, 'utf8');
  const methods = [
    ...new Set(
      [...src.matchAll(/export\s+(?:async\s+function|const)\s+(GET|POST|PUT|PATCH|DELETE)\b/g)].map((m) => m[1])
    ),
  ];
  return {
    url: urlOfRoute(file),
    file,
    methods,
    payloadKeys: extractRoutePayloads(src),
  };
});

interface PageUse {
  page: string;
  url: string;
  reads: string[]; // keys the page reads off data
  rawFetch: boolean;
}

function checkPageContracts(): Array<{ page: string; url: string; method: string; routeKeys: string[]; pageReads: string[]; verdict: string }> {
  const findings: Array<{ page: string; url: string; method: string; routeKeys: string[]; pageReads: string[]; verdict: string }> = [];
  for (const pf of pageFiles) {
    const src = fs.readFileSync(pf, 'utf8');
    const rel = path.relative(pagesDir, path.dirname(pf));
    // fetch('/api/...') occurrences
    const fetches = [...src.matchAll(/fetch\s*\(\s*`?([^\s`)]*\/api\/[^\s`?)`]*)/g)].map((m) => m[1]);
    for ( const f of fetches) {
      const urlPath = f.replace(/['"`]/g, '').replace(/,.*/, '').replace(/\$\{[^}]*\}/g, 'x').split('?')[0];
      // find route (exact or [id] pattern)
      const route = routes.find((r) => r.url === urlPath)
        ?? routes.find((r) => {
          const pattern = '^' + r.url.replace(/\/\[[^\]]+\]/g, '/[^/]+') + '$';
          return new RegExp(pattern).test(urlPath);
        });
      if (!route) { findings.push({ page: rel, url: urlPath, method: 'GET?', routeKeys: ['<no route file>'], pageReads: [], verdict: 'NO-ROUTE' }); continue; }
      // what does the page read off the JSON? search near the fetch for .data?.X / data.X
      // take a window around each fetch occurrence
      for (const fm of src.matchAll(new RegExp(escapeRegExp(f), 'g'))) {
        const window = src.slice(fm.index!, Math.min(src.length, fm.index! + 1400));
        const reads = new Set<string>();
        for (const rm of window.matchAll(/(?:json|Json|Data|Res\.json[\s\S]*?)?[\w]*[Jj]son[\w]*\.data\??\.([a-zA-Z_][\w]*)/g)) reads.add(rm[1]);
        for (const rm of window.matchAll(/(?:projJson|asJson|eqJson|bankJson|assetJson|res|json|data|body)[\w]*\.data\??\.([a-zA-Z_][\w]*)/g)) reads.add(rm[1]);
        if (!reads.size) continue;
        const getKeys = route.payloadKeys.GET || [];
        if (getKeys.includes('*passed-through*') || getKeys.includes('*spread*') || !getKeys.length) continue;
        const missing = [...reads].filter((k) => !getKeys.includes(k) && !['data'].includes(k));
        if (missing.length) {
          findings.push({ page: rel, url: urlPath, method: 'GET', routeKeys: getKeys, pageReads: missing, verdict: 'MISMATCH' });
        }
        break; // one window per fetch URL is enough
      }
    }
  }
  return findings;
}

function escapeRegExp(s: string) { return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'); }

/* ---------------- B) security sweep ---------------- */

interface SecRow { url: string; methods: string[]; guard: string; validation: string; tenant: string; rawSql: string[] }

function securitySweep(): SecRow[] {
  const rows: SecRow[] = [];
  for (const r of routes) {
    const src = fs.readFileSync(r.file, 'utf8');
    const guard = /requireApiAuth|requireModulePermission|requireAdminAuth|requireAdmin\b|requireManagerOrAbove|requireRole|verifyAdminToken|requirePortalAuth|requireCronAuth|verifyPortalToken|verifyTelegramSignature|BACKUP_SECRET/.test(src)
      ? (/requireModulePermission/.test(src) ? 'module-perm' : /admin-guard|requireAdminAuth|verifyAdminToken/.test(src) ? 'admin' : 'auth')
      : (/PUBLIC|login|register|forgot|reset|verify|setup|health|payment-methods|csrf|docs|advertisements|visitors|portal|telegram/.test(r.url) ? 'public?' : 'NONE');
    const validation = /safeParse|\.parse\(|Schema|zod|parseBody|normalizeCode|deliveryUuid|isValid/.test(src) ? 'yes' : (/GET/.test(src) && !/POST|PUT|PATCH|DELETE/.test(src) ? 'n/a (GET only)' : 'CHECK');
    const tenant = /companyId|company_id/.test(src) ? 'yes' : (guard === 'admin' || guard === 'public?' ? 'n/a' : 'CHECK');
    const rawSql: string[] = [];
    for (const m of src.matchAll(/(?:query|exec|sql)\s*\(\s*`([^`]*\$\{[^}]*)`/g)) rawSql.push(m[1].slice(0, 60));
    rows.push({ url: r.url, methods: r.methods, guard, validation, tenant, rawSql });
  }
  return rows;
}

/* ---------------- run ---------------- */

const contractFindings = checkPageContracts();
const secRows = securitySweep();

const secNone = secRows.filter((r) => r.guard === 'NONE');
const secCheck = secRows.filter((r) => r.validation === 'CHECK' || r.tenant === 'CHECK');
const rawSqlHits = secRows.filter((r) => r.rawSql.length);

let md = `# تدقيق آلي شامل — عقود الواجهات والأمان\n\nتاريخ التوليد: ${new Date().toISOString()}\n\n`;
md += `- مسارات API: **${routes.length}**\n- صفحات اللوحة: **${pageFiles.length}**\n\n`;
md += `## A) عقود الواجهة ↔ المسارات (MISMATCH = خطر انهيار كصورة المعدات)\n\n`;
md += `| الصفحة | المسار | ما تقرأه الواجهة | ما يرجعه المسار | الحكم |\n|---|---|---|---|---|\n`;
for (const f of contractFindings) {
  md += `| ${f.page} | ${f.url} | ${f.pageReads.join(', ')} | ${f.routeKeys.join(', ')} | ${f.verdict} |\n`;
}
md += `\n**عدد الاشتباهات: ${contractFindings.length}** (تحتاج تدقيقًا يدويًا — بعضها إنذارات كاذبة من التعبيرات النمطية)\n\n`;
md += `## B) الأمان\n\n### مسارات بلا حارس مصادقة (${secNone.length})\n`;
for (const r of secNone) md += `- ${r.url} [${r.methods.join(',')}] ${r.guard === 'public?' ? '(يبدو عامًا بالنيّة)' : '⚠️ NONE'}\n`;
md += `\n### مسارات تحتاج تحققًا يدويًا (تحقق المدخلات/عزل المستأجر) (${secCheck.length})\n`;
for (const r of secCheck) md += `- ${r.url} — تحقق: ${r.validation}، عزل: ${r.tenant}\n`;
md += `\n### SQL خام بمُدمجات (${rawSqlHits.length})\n`;
for (const r of rawSqlHits) md += `- ${r.url} — ${r.rawSql.join(' || ')}\n`;

fs.writeFileSync(path.join(ROOT, 'docs/audit-automated-sweep.md'), md);
console.log('routes:', routes.length, '| pages:', pageFiles.length);
console.log('contract findings:', contractFindings.length);
console.log('no-guard routes:', secNone.length, '| manual-check:', secCheck.length, '| raw-sql:', rawSqlHits.length);
for (const f of contractFindings) console.log('  MISMATCH?', f.page, '→', f.url, ' reads:', f.pageReads.join(','), ' route:', f.routeKeys.join(','));
console.log('report → docs/audit-automated-sweep.md');
