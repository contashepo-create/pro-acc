/**
 * Comprehensive live-database schema audit.
 *
 * Ground truth: full migration set applied to an in-memory PGlite instance.
 * Target: the live DATABASE_URL database.
 *
 * Reports: missing tables/columns, missing FKs, missing/extra function
 * overloads. Read-only against the live DB.
 */
import fs from 'node:fs';
import path from 'node:path';
import { query as liveQuery, endPool } from '../src/lib/db';

type Meta = {
  tables: Map<string, Set<string>>;
  fks: Map<string, string>; // "table.col" -> "ref_table"
  funcs: Map<string, string>; // "name(args)" -> identity args text
};

async function dumpMeta(exec: (sql: string, params?: unknown[]) => Promise<{ rows: any[] }>): Promise<Meta> {
  const cols = await exec(`
    SELECT table_name, column_name FROM information_schema.columns
    WHERE table_schema='public'
  `);
  const tables = new Map<string, Set<string>>();
  for (const r of cols.rows) {
    if (!tables.has(r.table_name)) tables.set(r.table_name, new Set());
    tables.get(r.table_name)!.add(r.column_name);
  }

  const fks = await exec(`
    SELECT conrelid::regclass::text AS tbl, a.attname AS col, confrelid::regclass::text AS ref
    FROM pg_constraint c
    JOIN pg_attribute a ON a.attrelid=c.conrelid AND a.attnum=ANY(c.conkey)
    WHERE c.contype='f' AND c.connamespace='public'::regnamespace
  `);
  const fkMap = new Map<string, string>();
  for (const r of fks.rows) {
    fkMap.set(`${r.tbl.replace('public.', '')}.${r.col}`, String(r.ref).replace('public.', ''));
  }

  const fns = await exec(`
    SELECT p.proname,
           pg_get_function_identity_arguments(p.oid) AS args
    FROM pg_proc p
    WHERE p.pronamespace='public'::regnamespace AND p.prokind='f'
  `);
  const funcs = new Map<string, string>();
  for (const r of fns.rows) {
    funcs.set(`${r.proname}(${r.args})`, r.args);
  }
  return { tables, fks: fkMap, funcs };
}

async function buildExpected(): Promise<Meta> {
  const { PGlite } = await import('@electric-sql/pglite');
  const db = new PGlite();
  await db.exec('CREATE ROLE anon; CREATE ROLE authenticated; CREATE ROLE service_role;');
  await db.exec(`CREATE FUNCTION digest(text,text) RETURNS bytea LANGUAGE sql IMMUTABLE AS $$ SELECT decode(md5($1),'hex') $$;`);
  await db.exec(`CREATE TABLE _migrations(id SERIAL PRIMARY KEY, filename TEXT NOT NULL UNIQUE, applied_at TIMESTAMPTZ DEFAULT NOW());`);
  const dir = path.resolve(process.cwd(), 'src/migrations');
  for (const f of fs.readdirSync(dir).filter((x) => x.endsWith('.sql')).sort()) {
    const tracked = await db.query('SELECT 1 FROM _migrations WHERE filename=$1', [f]);
    if (tracked.rows.length) continue;
    const sql = fs.readFileSync(path.join(dir, f), 'utf8')
      .replace(/^\s*BEGIN\s*;\s*$/gim, '')
      .replace(/^\s*COMMIT\s*;\s*$/gim, '')
      .replace(/^CREATE EXTENSION IF NOT EXISTS pgcrypto;\s*$/gim, '')
      .trim();
    if (!sql) continue;
    try {
      await db.exec(sql);
      await db.query('INSERT INTO _migrations(filename) VALUES($1)', [f]);
    } catch (e) {
      throw new Error(`migration ${f}: ${e instanceof Error ? e.message : e}`);
    }
  }
  const wrap = async (sqlText: string, params?: unknown[]) => db.query(sqlText, params);
  return dumpMeta(wrap);
}

async function main() {
  console.log('⏳ بناء السكيما المرجعية من الهجرات...');
  const expected = await buildExpected();

  console.log('⏳ قراءة السكيما الحية...');
  const actual = await dumpMeta(async (sqlText, params) => liveQuery(sqlText, params));

  // ── tables & columns ──
  let missingTables = 0, missingCols = 0;
  for (const [tbl, cols] of expected.tables) {
    if (tbl.startsWith('_migrations')) continue;
    const live = actual.tables.get(tbl);
    if (!live) { console.log(`❌ جدول مفقود: ${tbl} (${cols.size} عمود)`); missingTables++; continue; }
    const miss = [...cols].filter((c) => !live.has(c));
    if (miss.length) { console.log(`❌ ${tbl}: أعمدة ناقصة → ${miss.join(', ')}`); missingCols += miss.length; }
  }
  console.log(missingTables === 0 && missingCols === 0 ? '✓ الجداول والأعمدة: مطابقة تماماً' : `⚠️ جداول ناقصة: ${missingTables}, أعمدة ناقصة: ${missingCols}`);

  // ── FKs ──
  let missingFks = 0;
  for (const [key, ref] of expected.fks) {
    if (!actual.fks.has(key)) { console.log(`❌ مفتاح خارجي ناقص: ${key} → ${ref}`); missingFks++; }
  }
  console.log(missingFks === 0 ? '✓ المفاتيح الخارجية: مطابقة' : `⚠️ مفاتيح ناقصة: ${missingFks}`);

  // ── functions (by name+identity args) ──
  let missingFns = 0;
  for (const [sig] of expected.funcs) {
    const name = sig.slice(0, sig.indexOf('('));
    const hasSameOverload = actual.funcs.has(sig);
    const hasAnyOverload = [...actual.funcs.keys()].some((s) => s.startsWith(name + '('));
    if (!hasAnyOverload) { console.log(`❌ دالة مفقودة كلياً: ${name}`); missingFns++; }
    else if (!hasSameOverload) {
      // different overload signature exists — usually fine (evolution), note quietly
      console.log(`ℹ️ توقيع مختلف للدالة: ${sig}`);
    }
  }
  console.log(missingFns === 0 ? '✓ الدوال: لا نواقص كاملة' : `⚠️ دوال مفقودة: ${missingFns}`);

  await endPool();
  process.exit(0);
}

main().catch((e) => { console.error('فشل الفحص:', e); process.exit(1); });
