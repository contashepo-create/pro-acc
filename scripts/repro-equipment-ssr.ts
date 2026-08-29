/**
 * SSR/browser replay for the equipment-costs page crash (production error
 * boundary). Renders the page against REAL payloads recorded by
 * equipment-live-repro.ts (real routes + real Postgres via PGlite).
 */
import * as React from 'react';
import { renderToString } from 'react-dom/server';
import * as fs from 'node:fs';
import * as path from 'node:path';

const fixturesFile = process.argv[2]
  || path.join(__dirname, 'equipment-live-fixtures.json');
const fixtures = JSON.parse(fs.readFileSync(fixturesFile, 'utf8')) as Record<string, any>;

// Minimal fetch mock served from the recorded fixtures
(globalThis as any).fetch = (url: string) => {
  const clean = String(url).split('?')[0];
  const hit = fixtures[clean];
  if (!hit) {
    console.error('NO FIXTURE FOR', clean);
    return Promise.resolve({ ok: true, status: 200, json: () => Promise.resolve({ success: false, message: 'no fixture' }) });
  }
  return Promise.resolve({ ok: true, status: hit.status, json: () => Promise.resolve(hit.body) });
};

async function main() {
  const mod = await import('../src/app/(dashboard)/equipment/page');
  const Page = mod.default;
  const html = renderToString(React.createElement(Page));
  console.log('SSR OK — length:', html.length);
  // Flush microtasks so post-render effects/fetch resolutions complete
  await new Promise((r) => setTimeout(r, 100));
  console.log('DONE');
}

main().catch((err) => {
  console.error('SSR CRASH:', err && (err.stack || err.message || String(err)));
  process.exit(1);
});
