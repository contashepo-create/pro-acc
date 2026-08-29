/**
 * Audit runner: node scripts/accounting-audit/run.mjs [name-substring]
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { initDb, seedTenant, runSection, printSummary } from './framework.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const filter = process.argv[2] || '';

const { db, migrationCount } = await initDb();
console.log(`audit db ready — ${migrationCount} migrations applied`);

const A = await seedTenant(db, { name: 'شركة المراجعة أ', email: 'audit-a@example.test', country: 'SA' });
const B = await seedTenant(db, { name: 'شركة المراجعة ب', email: 'audit-b@example.test', country: 'SA' });
const E = await seedTenant(db, { name: 'شركة المراجعة مصر', email: 'audit-eg@example.test', country: 'EG' });
const ctx = { db, A, B, E };

const sections = fs.readdirSync(path.join(__dirname, 'sections'))
  .filter((f) => f.endsWith('.mjs'))
  .sort()
  .map((f) => f.replace(/\.mjs$/, ''))
  .filter((name) => !filter || name.includes(filter));

const results = [];
for (const name of sections) {
  const mod = await import(path.join(__dirname, 'sections', `${name}.mjs`));
  results.push(await runSection(mod.name, mod.run, ctx));
}
const ok = printSummary(results);
await db.close();
process.exit(ok ? 0 : 1);
