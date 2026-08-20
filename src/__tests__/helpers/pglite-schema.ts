/**
 * PGlite full-schema helper for database-level (*.db.test.ts) tests.
 *
 * Spins up an in-memory PGlite Postgres instance, applies every migration
 * file in src/migrations/ (mirroring the logic from test-migrations.mjs),
 * then calls setup_initial_company() so callers get a ready-made company_id,
 * user_id, and a full chart-of-accounts.
 *
 * Because PGlite uses dynamic import(), Jest MUST be started with
 * --experimental-vm-modules (the "test:db" script does this).
 */

import fs from 'node:fs';
import path from 'node:path';

/* ---------- public types ---------- */
export interface SchemaContext {
  db: any; // PGlite instance
  companyId: string;
  userId: string;
  /** Convenience wrapper: db.query(sql, params) */
  query: (sql: string, params?: any[]) => Promise<any>;
  /** Convenience wrapper: db.exec(sql) */
  exec: (sql: string) => Promise<void>;
  close: () => Promise<void>;
}

/* ---------- chart of accounts seed (same as test-migrations.mjs) ---------- */
const COA_SEED = [
  '1000', '1110', '1130', '1150', '1160', '1180', '1230', '1290',
  '2120', '2140',
  '3000', '3200',
  '4100',
  '5100',
].map((code) => ({
  code,
  name: `حساب ${code}`,
  name_en: `Account ${code}`,
  type: code === '4100' ? 'revenue'
    : code === '5100' ? 'expense'
    : ['2120', '2140'].includes(code) ? 'liability'
    : code.startsWith('3') ? 'equity'
    : 'asset',
  parent_code: null,
  is_header: false,
}));

/* ---------- bootstrap ---------- */
export async function createSchemaContext(): Promise<SchemaContext> {
  const { PGlite } = await import('@electric-sql/pglite');
  const db = new PGlite();

  // Supabase pre-creates these roles.
  await db.exec('CREATE ROLE anon; CREATE ROLE authenticated; CREATE ROLE service_role;');

  // PGlite doesn't ship pgcrypto — provide a shim for digest().
  await db.exec(`
    CREATE FUNCTION digest(text, text) RETURNS bytea
    LANGUAGE sql IMMUTABLE AS $$ SELECT decode(md5($1), 'hex') $$;
  `);

  // Migration tracking table.
  await db.exec(`
    CREATE TABLE _migrations(
      id SERIAL PRIMARY KEY,
      filename TEXT NOT NULL UNIQUE,
      applied_at TIMESTAMPTZ DEFAULT NOW()
    );
  `);

  // Apply every migration in order.
  const migrationsDir = path.resolve(process.cwd(), 'src/migrations');
  const files = fs.readdirSync(migrationsDir).filter((f) => f.endsWith('.sql')).sort();

  for (const filename of files) {
    const tracked = await db.query('SELECT 1 FROM _migrations WHERE filename=$1', [filename]);
    if (tracked.rows.length) continue;
    let sql = fs.readFileSync(path.join(migrationsDir, filename), 'utf8')
      .replace(/^\s*BEGIN\s*;\s*$/gim, '')
      .replace(/^\s*COMMIT\s*;\s*$/gim, '')
      .replace(/^CREATE EXTENSION IF NOT EXISTS pgcrypto;\s*$/gim, '')
      .trim();
    await db.exec('BEGIN');
    try {
      if (sql) await db.exec(sql);
      await db.query('INSERT INTO _migrations(filename) VALUES($1)', [filename]);
      await db.exec('COMMIT');
    } catch (error: any) {
      await db.exec('ROLLBACK');
      throw new Error(`Migration ${filename}: ${error.message}`, { cause: error });
    }
  }

  // Setup a company with the standard COA so tests have a ready-made tenant.
  const setupResult = await db.query(
    `SELECT setup_initial_company(
       'شركة الاختبار', '', '', 'test@example.test', 'Test Owner', 'password_hash',
       $1::jsonb
     ) AS result`,
    [JSON.stringify(COA_SEED)],
  );

  const { company, user } = setupResult.rows[0].result;

  return {
    db,
    companyId: company.id,
    userId: user.id,
    query: (sql, params) => db.query(sql, params),
    exec: (sql) => db.exec(sql),
    close: () => db.close(),
  };
}
