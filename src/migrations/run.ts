import * as fs from 'fs';
import * as path from 'path';
import { query, transaction } from '@/lib/db';

const MIGRATIONS_DIR = path.resolve(__dirname);

interface Migration {
  filename: string;
  sql: string;
}

/**
 * Ensure the _migrations tracking table exists.
 */
async function ensureMigrationTable(): Promise<void> {
  await query(`
    CREATE TABLE IF NOT EXISTS _migrations (
      id SERIAL PRIMARY KEY,
      filename TEXT NOT NULL UNIQUE,
      applied_at TIMESTAMPTZ DEFAULT NOW()
    )
  `);
}

/**
 * Return already-applied migration filenames.
 */
async function getAppliedMigrations(): Promise<Set<string>> {
  const result = await query<{ filename: string }>(
    'SELECT filename FROM _migrations ORDER BY id'
  );
  return new Set(result.rows.map((r) => r.filename));
}

/**
 * Discover migration SQL files in the migrations directory.
 * Files are sorted alphabetically by filename to ensure order.
 */
function discoverMigrations(): Migration[] {
  const files = fs
    .readdirSync(MIGRATIONS_DIR)
    .filter((f) => f.endsWith('.sql'))
    .sort();

  assertNoNewDuplicateNumbers(files);

  return files.map((filename) => {
    const sql = fs.readFileSync(path.join(MIGRATIONS_DIR, filename), 'utf-8');
    return { filename, sql };
  });
}

/**
 * Historical files that share a numeric prefix. They are already applied in
 * production under these exact filenames, and `_migrations` tracks by
 * filename, so renaming them would re-run their SQL. They are frozen as
 * documented exceptions; ANY new duplicate prefix aborts the runner.
 */
const LEGACY_DUPLICATE_PREFIXES: Record<string, string[]> = {
  '011': ['011-final-security-accounting.sql', '011-fix-all-sequences-race-condition.sql'],
  '012': ['012-atomic-journal-entry-insert.sql', '012-enhanced-custody-system.sql'],
  '015': ['015-branding-and-features.sql', '015-fix-schema-mismatches.sql'],
  '016': ['016-approval-system.sql', '016-payment-portal-contracts.sql'],
};

export function assertNoNewDuplicateNumbers(files: string[]): void {
  const byPrefix = new Map<string, string[]>();
  for (const f of files) {
    const prefix = f.split('-')[0];
    if (!/^\d+$/.test(prefix)) continue;
    const list = byPrefix.get(prefix) || [];
    list.push(f);
    byPrefix.set(prefix, list);
  }

  for (const [prefix, list] of byPrefix) {
    if (list.length < 2) continue;
    const allowed = LEGACY_DUPLICATE_PREFIXES[prefix];
    const isLegacy =
      allowed &&
      list.length === allowed.length &&
      list.every((f) => allowed.includes(f));
    if (!isLegacy) {
      throw new Error(
        `Duplicate migration number "${prefix}": ${list.join(', ')}. ` +
          'Use the next free sequential number for new migrations.'
      );
    }
  }
}

/**
 * Apply pending migrations.
 *
 * If `targetFilename` is provided, only that specific migration is applied
 * (useful for roll-forward fixes). Otherwise all pending migrations run.
 */
export async function runMigrations(targetFilename?: string): Promise<void> {
  await ensureMigrationTable();

  const applied = await getAppliedMigrations();
  const all = discoverMigrations();

  const pending = targetFilename
    ? all.filter((m) => m.filename === targetFilename)
    : all.filter((m) => !applied.has(m.filename));

  if (pending.length === 0) {
    console.log('No pending migrations.');
    return;
  }

  for (const migration of pending) {
    console.log(`Applying: ${migration.filename}...`);

    try {
      await transaction(async (client) => {
        // Split on statement-level COMMIT so we can run the entire file
        // inside our own transaction wrapper.
        const statements = migration.sql
          .split(';')
          .map((s) => s.trim())
          .filter((s) => s.length > 0 && !s.toUpperCase().startsWith('COMMIT'));

        for (const stmt of statements) {
          await client.query(stmt);
        }

        await client.query(
          'INSERT INTO _migrations (filename) VALUES ($1)',
          [migration.filename]
        );
      });

      console.log(`  ✓ ${migration.filename}`);
    } catch (err) {
      console.error(`  ✗ ${migration.filename} failed:`, err);
      throw err;
    }
  }
}

/**
 * CLI entry point.
 *
 * Usage:
 *   npx tsx src/migrations/run.ts              # run all pending
 *   npx tsx src/migrations/run.ts 002-fix.sql  # run one
 */
if (require.main === module) {
  const target = process.argv[2];
  runMigrations(target)
    .then(() => {
      console.log('Done.');
      process.exit(0);
    })
    .catch((err) => {
      console.error('Migration failed:', err);
      process.exit(1);
    });
}
