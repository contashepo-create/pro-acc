/**
 * Live reproduction harness — runs the REAL route handlers
 * (/api/equipment-costs, /api/projects, /api/fixed-assets) against a REAL
 * in-process Postgres (PGlite + full migration schema + setup_initial_company)
 * and writes the exact JSON payloads the browser would receive into
 * scripts/equipment-live-fixtures.json.
 *
 * The client page is then replayed against these payloads by
 * scripts/repro-equipment-ssr.ts, proving/refuting the production
 * "نعتذر عن هذا الخطأ" crash end-to-end with real data shapes.
 *
 * Usage: npx tsx scripts/equipment-live-repro.ts [scenario]
 *   scenarios: basic | hostile | empty
 */
process.env.TOKEN_SECRET = 'live-repro-token-secret-0123456789abcdef';

const scenario = process.argv[2] || 'basic';

function injectSupabase(adapter: unknown) {
  // Patch the CJS require cache BEFORE any route/lib module is required, so
  // every importer of '@/lib/supabase-client' receives the PGlite adapter.
  const Module = require('node:module');
  const clientPath = require.resolve('../src/lib/supabase-client');
  require.cache[clientPath] = {
    id: clientPath, filename: clientPath, loaded: true,
    exports: { getSupabase: () => adapter },
    children: [], parent: null, path: clientPath,
  } as unknown as NodeModule;
  void Module;
}

async function main() {
  const { createSchemaContext } = require('../src/__tests__/helpers/pglite-schema');
  const { makePgSupabase } = require('../src/__tests__/helpers/pg-supabase-adapter');

  console.log('booting PGlite + full migration schema (this takes ~1-2 min)…');
  const ctx = await createSchemaContext();
  console.log('schema ready — company:', ctx.companyId, 'user:', ctx.userId);

  const sb = makePgSupabase(ctx.db);
  injectSupabase(sb);

  // Seed scenario data through real SQL
  await seed(ctx, scenario);

  const { createToken } = require('../src/lib/auth');
  const userRow = (await ctx.query(
    'SELECT role, token_version FROM users WHERE id=$1', [ctx.userId])).rows[0] as any;
  const token = createToken(ctx.userId, userRow.role, Number(userRow.token_version) || 0);

  const { resetRateLimits } = require('../src/lib/memory-rate-limit');
  resetRateLimits();

  const routes = {
    '/api/equipment-costs': require('../src/app/api/equipment-costs/route'),
    '/api/projects': require('../src/app/api/projects/route'),
    '/api/fixed-assets': require('../src/app/api/fixed-assets/route'),
  };

  const { NextRequest } = require('next/server');
  const fixtures: Record<string, unknown> = {};

  for (const [url, mod] of Object.entries(routes)) {
    resetRateLimits();
    const req = new NextRequest(`http://localhost:3000${url}`, {
      headers: { authorization: `Bearer ${token}` },
    });
    const res = await (mod as any).GET(req);
    const body = await res.json();
    fixtures[url] = { status: res.status, body };
    console.log(`${url} → ${res.status}`, JSON.stringify(body).slice(0, 300));
  }

  require('node:fs').writeFileSync(
    require('node:path').join(__dirname, 'equipment-live-fixtures.json'),
    JSON.stringify({ scenario, ...fixtures }, null, 2));
  console.log('fixtures written (scenario:', scenario + ')');

  await ctx.close();
}

async function seed(ctx: { query: (sql: string, p?: unknown[]) => Promise<{ rows: any[] }>; companyId: string; userId: string }, name: string) {
  const q = (sql: string, p?: unknown[]) => ctx.query(sql, p);
  const company = ctx.companyId;

  if (name === 'empty') return;

  // The schema's tenant guards require writes to go through lifecycle RPCs
  // (exactly like production). Direct seeding is allowed only inside a
  // transaction that sets the guard's GUC — mirroring what those RPCs do.
  async function guardedInsert(sql: string, params: unknown[], guc: string) {
    await q('BEGIN');
    try {
      await q(`SELECT set_config($1, $2, true)`, [guc, company]);
      await q(sql, params);
      await q('COMMIT');
    } catch (e) {
      await q('ROLLBACK');
      throw e;
    }
  }

  // A project and an asset owned by this company
  const proj = (await q(
    `SELECT id FROM projects WHERE company_id=$1 ORDER BY created_at LIMIT 1`, [company])).rows[0]
    ?? (await (async () => {
      await guardedInsert(
        `INSERT INTO projects (company_id, name, contract_value, start_date, status, created_by)
         VALUES ($1, 'مشروع برج العاصمة', 1000000, CURRENT_DATE, 'active', $2)`, [company, ctx.userId],
        'app.project_write_company');
      return (await q(`SELECT id FROM projects WHERE company_id=$1 ORDER BY created_at DESC LIMIT 1`, [company])).rows[0];
    })());

  let asset: { id: string };
  await guardedInsert(
    `INSERT INTO fixed_assets (company_id, name, code, category, purchase_date, purchase_cost, useful_life_years,
       accumulated_depreciation, net_book_value)
     VALUES ($1, 'حفارة كاتربلر 320', 'EQ-001', 'machinery', CURRENT_DATE, 500000, 10, 0, 500000) RETURNING id`,
    [company], 'app.asset_write_company');
  asset = (await q(`SELECT id FROM fixed_assets WHERE company_id=$1 ORDER BY created_at DESC LIMIT 1`, [company])).rows[0];

  if (name === 'hostile') {
    // Rows designed to stress the UI: null refs, JSON null numerics,
    // maximum numeric precision, unicode/quoted notes — everything the
    // production table may legally contain. (A NULL project name is
    // impossible — the DB guard rejects it — so it's excluded.)
    await guardedInsert(
      `INSERT INTO equipment_costs (company_id, equipment_id, project_id, date, cost_type, amount, usage_hours, notes) VALUES
        ($1, $2, $3, CURRENT_DATE, 'fuel', 99999999999.99, 24.5, ' وقود برقم غريب "" \\\\ <b>x</b> '),
        ($1, NULL, NULL, CURRENT_DATE - 1, 'other', 0.01, 0, NULL),
        ($1, NULL, $3, CURRENT_DATE - 2, 'depreciation', 12345.67, NULL, 'إهلاك شهري'),
        ($1, $2, NULL, CURRENT_DATE - 3, 'rental', 500, NULL, NULL)`,
      [company, asset.id, proj.id], 'app.project_write_company');
  } else {
    await guardedInsert(
      `INSERT INTO equipment_costs (company_id, equipment_id, project_id, date, cost_type, amount, usage_hours, notes) VALUES
        ($1, $2, $3, CURRENT_DATE, 'fuel', 250.50, 4, 'تعبئة وقود'),
        ($1, NULL, NULL, CURRENT_DATE - 1, 'other', 100, NULL, 'تنظيف')`,
      [company, asset.id, proj.id], 'app.project_write_company');
  }
  console.log('seeded scenario:', name);
}

main().catch((err) => {
  console.error('REPRO FAILED:', err && (err.stack || err.message || String(err)));
  process.exit(1);
});
