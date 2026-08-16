/**
 * Database drivers for the migration + RPC smoke suite.
 *
 * The same suite must prove the schema on two very different engines:
 *
 *  - `pglite`   — fast, in-process WASM PostgreSQL used for the default
 *                 developer/CI loop. It ships no `pgcrypto`, so the runner
 *                 installs a `digest()` shim and strips `CREATE EXTENSION`.
 *  - `postgres` — a REAL PostgreSQL server (embedded-postgres) that behaves
 *                 exactly like the deployed Supabase instance: genuine
 *                 `pgcrypto`, real planner, real constraint/lock semantics and
 *                 real multi-connection concurrency.
 *
 * Historically the suite only ran on PGlite, so "migrations apply cleanly" was
 * never actually proven against a real server. Selecting the driver with
 * `MIGRATION_DRIVER=postgres` closes that gap without forking the suite.
 */
import path from 'node:path';
import fs from 'node:fs';
import os from 'node:os';
import { randomBytes } from 'node:crypto';

/**
 * PGlite driver — single in-process connection.
 */
async function createPgliteDriver() {
  const { PGlite } = await import('@electric-sql/pglite');
  const db = new PGlite();
  return {
    name: 'pglite',
    /** PGlite has no pgcrypto; the suite installs a digest() shim instead. */
    hasPgcrypto: false,
    /** Single in-process connection: statements are inherently serialized. */
    supportsRealConcurrency: false,
    query: (sql, params) => db.query(sql, params),
    exec: (sql) => db.exec(sql),
    /** No separate connections available; run the callback on the main one. */
    withConnection: async (fn) => fn({
      query: (sql, params) => db.query(sql, params),
      exec: (sql) => db.exec(sql),
    }),
    close: () => db.close(),
  };
}

/**
 * Real PostgreSQL driver backed by an ephemeral embedded server.
 *
 * Migrations mix `exec('BEGIN')` / `query(...)` / `exec('COMMIT')`, so the
 * primary handle must be ONE pinned connection — otherwise a pooled
 * `INSERT INTO _migrations` would land outside the migration's transaction and
 * a failed migration would leave a bogus "applied" row behind. Tests that need
 * genuine parallelism ask for extra connections via `withConnection`.
 */
async function createPostgresDriver() {
  const EmbeddedPostgres = (await import('embedded-postgres')).default;
  const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'pro-acc-pgdata-'));
  const port = Number(process.env.MIGRATION_PG_PORT || 55432);

  // Ephemeral throwaway server on loopback, deleted after the run. The
  // credential is generated per run rather than hardcoded so no password
  // literal exists in the repository for secret scanners to flag.
  const user = 'pro_acc_migration_test';
  const password = randomBytes(24).toString('hex');

  const server = new EmbeddedPostgres({
    databaseDir: dataDir,
    user,
    password,
    port,
    persistent: false,
    // The server is a short-lived test fixture; its chatter would bury the
    // assertion output that actually matters.
    onLog: () => {},
    onError: () => {},
  });

  await server.initialise();
  await server.start();

  const pg = await import('pg');
  const { Client } = pg.default ?? pg;

  // node-postgres returns int8/numeric as STRINGS to avoid precision loss,
  // while PGlite returns JS numbers. The shared smoke suite asserts against
  // both engines, so normalise here rather than sprinkling Number() casts —
  // otherwise a real-Postgres run fails on '0' !== 0 instead of on real
  // schema defects. Parsers are scoped to these test connections only.
  const typeParsers = {
    20: (value) => Number(value),    // int8 / bigint  (count(*) etc.)
    1700: (value) => Number(value),  // numeric        (money amounts)
    1114: (value) => value,          // timestamp      (keep as string)
  };

  const connect = async () => {
    const client = new Client({
      host: '127.0.0.1', port, user, password, database: 'postgres',
      types: {
        getTypeParser: (oid, format) => typeParsers[oid]
          ?? (pg.default ?? pg).types.getTypeParser(oid, format),
      },
    });
    await client.connect();
    return client;
  };

  const primary = await connect();
  const extraClients = [];

  return {
    name: 'postgres',
    /** A real server: use the genuine extension, not a shim. */
    hasPgcrypto: true,
    supportsRealConcurrency: true,
    query: (sql, params) => primary.query(sql, params),
    exec: (sql) => primary.query(sql),
    /** Hand out an independent connection so callers get true parallelism. */
    withConnection: async (fn) => {
      const client = await connect();
      extraClients.push(client);
      try {
        return await fn({
          query: (sql, params) => client.query(sql, params),
          exec: (sql) => client.query(sql),
        });
      } finally {
        extraClients.splice(extraClients.indexOf(client), 1);
        await client.end().catch(() => {});
      }
    },
    close: async () => {
      await Promise.all(extraClients.map((client) => client.end().catch(() => {})));
      await primary.end().catch(() => {});
      await server.stop().catch(() => {});
      fs.rmSync(dataDir, { recursive: true, force: true });
    },
  };
}

export async function createDriver(name = process.env.MIGRATION_DRIVER || 'pglite') {
  if (name === 'postgres') return createPostgresDriver();
  if (name === 'pglite') return createPgliteDriver();
  throw new Error(`Unknown MIGRATION_DRIVER "${name}" (expected "pglite" or "postgres")`);
}
