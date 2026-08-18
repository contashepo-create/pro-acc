/**
 * Global developer backup: dumps the WHOLE database (all companies and all
 * users) with pg_dump, verifies it, stores it, delivers it to the developer's
 * Telegram, and prunes everything older than the last N copies.
 *
 * Usage:
 *   npx tsx scripts/global-backup.ts
 *
 * Environment:
 *   DATABASE_URL              (required) Postgres connection, e.g.
 *                             postgresql://...:5432/postgres?sslmode=require
 *   TELEGRAM_BOT_TOKEN        (required) the bot that receives the dump
 *   TELEGRAM_ADMIN_CHAT_ID    (required) the developer's chat id
 *   NEXT_PUBLIC_SUPABASE_URL  storage project (fallback SUPABASE_URL)
 *   SUPABASE_SERVICE_ROLE_KEY storage service key (used only for storage)
 *   BACKUP_RETAIN             copies to keep, oldest pruned first (default 5)
 *   TELEGRAM_MAX_FILE_MB      dumps above this size are stored-only and a
 *                             metadata message is sent instead (default 45,
 *                             Telegram's bot upload limit is 50 MB)
 *
 * Scheduling is owned by .github/workflows/global-backup.yml
 * (cron every 6 hours by default — see that file for the hourly variant).
 */
import 'dotenv/config';
import { execFile } from 'child_process';
import { promisify } from 'util';
import { createHash } from 'crypto';
import { readFile, stat, unlink } from 'fs/promises';
import * as os from 'os';
import * as path from 'path';
import { Pool } from 'pg';
import { createClient } from '@supabase/supabase-js';
import { planRetention, backupFilename, type BackupJournalEntry } from '../src/lib/backup-retention';

const run = promisify(execFile);

function env(name: string, fallback = ''): string {
  return (process.env[name] || fallback).trim();
}

function fail(message: string): never {
  console.error(`✗ ${message}`);
  process.exit(1);
}

async function main() {
  const databaseUrl = env('DATABASE_URL');
  const botToken = env('TELEGRAM_BOT_TOKEN');
  const chatId = env('TELEGRAM_ADMIN_CHAT_ID');
  const supabaseUrl = env('NEXT_PUBLIC_SUPABASE_URL') || env('SUPABASE_URL');
  const supabaseKey = env('SUPABASE_SERVICE_ROLE_KEY');
  const retain = Math.max(1, parseInt(env('BACKUP_RETAIN', '5'), 10) || 5);
  const maxFileMb = Math.min(49, Math.max(1, parseFloat(env('TELEGRAM_MAX_FILE_MB', '45')) || 45));

  if (!databaseUrl) fail('DATABASE_URL is not set');
  if (!botToken) fail('TELEGRAM_BOT_TOKEN is not set');
  if (!chatId) fail('TELEGRAM_ADMIN_CHAT_ID is not set');

  // ---------- 1. pg_dump the whole database (all tenants) ----------
  const filename = backupFilename();
  const dumpPath = path.join(os.tmpdir(), filename);
  console.log(`[1/6] pg_dump → ${dumpPath}`);
  await run('pg_dump', [
    '--format=custom', '--compress=9', '--no-owner', '--no-acl',
    '--file', dumpPath, databaseUrl,
  ], { timeout: 30 * 60_000, maxBuffer: 1024 * 1024 });

  const { size } = await stat(dumpPath);
  const sha256 = createHash('sha256').update(await readFile(dumpPath)).digest('hex');
  console.log(`[2/6] dump ready: ${(size / 1024 / 1024).toFixed(2)} MB, sha256 ${sha256}`);

  // ---------- 2. Journal + live row counts ----------
  const pool = new Pool({ connectionString: databaseUrl });
  await pool.query(`
    CREATE TABLE IF NOT EXISTS global_backup_journal (
      id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
      filename TEXT NOT NULL,
      size_bytes BIGINT NOT NULL,
      sha256 TEXT NOT NULL,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      storage_path TEXT,
      telegram_message_id TEXT,
      extra JSONB
    )`);
  const { rows: counts } = await pool.query(`
    SELECT
      (SELECT COUNT(*) FROM companies) AS companies,
      (SELECT COUNT(*) FROM users) AS users,
      (SELECT COUNT(*) FROM journal_entries) AS journal_entries,
      (SELECT COUNT(*) FROM journal_lines) AS journal_lines`);

  // ---------- 3. Storage copy (source of truth for retention) ----------
  let storagePath: string | null = null;
  if (supabaseUrl && supabaseKey) {
    try {
      const supabase = createClient(supabaseUrl, supabaseKey, {
        auth: { persistSession: false, autoRefreshToken: false },
      });
      await supabase.storage.createBucket('global-db-backups', { public: false }).catch(() => undefined);
      const { error: uploadError } = await supabase.storage
        .from('global-db-backups')
        .upload(filename, await readFile(dumpPath), { contentType: 'application/octet-stream', upsert: false });
      if (uploadError) throw uploadError;
      storagePath = `global-db-backups/${filename}`;
      console.log(`[3/6] stored: ${storagePath}`);
    } catch (storageError) {
      console.warn(`[3/6] storage upload failed (continuing Telegram-only):`, storageError);
    }
  } else {
    console.warn('[3/6] storage not configured; retention will prune the Telegram chat only');
  }

  // ---------- 4. Telegram delivery ----------
  const caption = `🗄 <b>نسخة احتياطية شاملة لقاعدة البيانات</b>\n`
    + `📦 <code>${filename}</code>\n`
    + `📏 الحجم: ${(size / 1024 / 1024).toFixed(2)} MB\n`
    + `🔑 SHA-256: <code>${sha256}</code>\n`
    + `👥 الشركات: ${counts[0].companies} · المستخدمون: ${counts[0].users}\n`
    + `📒 القيود: ${counts[0].journal_entries} · الأسطر: ${counts[0].journal_lines}`;

  let telegramMessageId: string | null = null;
  if (size <= maxFileMb * 1024 * 1024) {
    const form = new FormData();
    form.append('chat_id', chatId);
    form.append('document', new Blob([await readFile(dumpPath)]), filename);
    form.append('caption', caption);
    form.append('parse_mode', 'HTML');
    const response = await fetch(`https://api.telegram.org/bot${botToken}/sendDocument`, {
      method: 'POST', body: form, signal: AbortSignal.timeout(300_000),
    });
    const body = await response.json() as any;
    if (!response.ok || !body.ok) throw new Error(`Telegram sendDocument failed: ${JSON.stringify(body)}`);
    telegramMessageId = String(body.result?.message_id ?? '');
    console.log(`[4/6] sent to Telegram (message ${telegramMessageId})`);
  } else {
    const message = `${caption}\n\n⚠️ الملف أكبر من حد تيليجرام (${maxFileMb} MB)؛ متاح في التخزين: <code>${storagePath || 'غير متاح'}</code>\n`
      + `للاسترجاع: <code>npx tsx scripts/restore-global-backup.ts</code>`;
    const response = await fetch(`https://api.telegram.org/bot${botToken}/sendMessage`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      signal: AbortSignal.timeout(30_000),
      body: JSON.stringify({ chat_id: chatId, text: message, parse_mode: 'HTML' }),
    });
    const body = await response.json() as any;
    if (!response.ok || !body.ok) throw new Error(`Telegram sendMessage failed: ${JSON.stringify(body)}`);
    telegramMessageId = String(body.result?.message_id ?? '');
    console.log(`[4/6] dump too large for Telegram (${(size / 1024 / 1024).toFixed(2)} MB) — metadata sent`);
  }

  // ---------- 5. Journal ----------
  await pool.query(
    `INSERT INTO global_backup_journal(filename, size_bytes, sha256, storage_path, telegram_message_id, extra)
     VALUES($1,$2,$3,$4,$5,$6)`,
    [filename, size, sha256, storagePath, telegramMessageId, JSON.stringify(counts[0])],
  );

  // ---------- 6. Retention: keep the last N copies only ----------
  const { rows: entries } = await pool.query<BackupJournalEntry>(
    `SELECT id, filename, size_bytes AS "sizeBytes", sha256, created_at AS "createdAt",
            storage_path AS "storagePath", telegram_message_id AS "telegramMessageId"
     FROM global_backup_journal ORDER BY created_at ASC, id ASC`,
  );
  const { prune } = planRetention(entries, retain);
  const supabase = supabaseUrl && supabaseKey
    ? createClient(supabaseUrl, supabaseKey, { auth: { persistSession: false, autoRefreshToken: false } })
    : null;
  for (const old of prune) {
    console.log(`[5/6] pruning old copy ${old.filename}`);
    if (old.storagePath && supabase) {
      await supabase.storage.from('global-db-backups').remove([old.storagePath.split('/').pop()!]).catch(() => undefined);
    }
    if (old.telegramMessageId) {
      await fetch(`https://api.telegram.org/bot${botToken}/deleteMessage`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        signal: AbortSignal.timeout(15_000),
        body: JSON.stringify({ chat_id: chatId, message_id: Number(old.telegramMessageId) }),
      }).catch(() => undefined);
    }
    await pool.query('DELETE FROM global_backup_journal WHERE id=$1', [old.id]);
  }
  console.log(`[6/6] done — keeping the latest ${retain} copies`);

  await unlink(dumpPath).catch(() => undefined);
  await pool.end();
}

main().catch((cause) => {
  console.error('Global backup failed:', cause instanceof Error ? cause.message : cause);
  process.exit(1);
});
