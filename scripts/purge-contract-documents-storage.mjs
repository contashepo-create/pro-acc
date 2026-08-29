#!/usr/bin/env node
// One-time purge of the cancelled `contract-documents` storage bucket (migration 116).
//
// Supabase blocks direct SQL deletes on storage.objects (storage.protect_delete
// raises 42501 "Direct deletion from storage tables is not allowed"), so the
// objects MUST be removed through the Storage API. This script:
//   1. recursively lists every object in the bucket,
//   2. removes them in batches via the Storage API (service-role key),
//   3. deletes the now-empty bucket.
//
// Usage:  node scripts/purge-contract-documents-storage.mjs
// Needs:  NEXT_PUBLIC_SUPABASE_URL (or SUPABASE_URL) + SUPABASE_SERVICE_ROLE_KEY
//         from the environment or .env.local (loaded automatically).
// Idempotent: safe to re-run; an already-empty/missing bucket is reported and skipped.
import fs from 'node:fs';
import path from 'node:path';
import { createClient } from '@supabase/supabase-js';

const BUCKET = 'contract-documents';

function loadEnvFile(file) {
  const full = path.resolve(file);
  if (!fs.existsSync(full)) return;
  for (const line of fs.readFileSync(full, 'utf8').split('\n')) {
    const match = line.match(/^\s*([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)\s*$/);
    if (!match) continue;
    const key = match[1];
    if (process.env[key] === undefined) {
      process.env[key] = match[2].replace(/^["']|["']$/g, '');
    }
  }
}

loadEnvFile('.env.local');
loadEnvFile('.env');

const url = process.env.SUPABASE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL;
const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
if (!url || !key) {
  console.error(
    'Missing Supabase credentials. Provide SUPABASE_URL (or NEXT_PUBLIC_SUPABASE_URL)\n' +
    'and SUPABASE_SERVICE_ROLE_KEY in the environment or .env.local, then re-run:\n' +
    '  node scripts/purge-contract-documents-storage.mjs'
  );
  process.exit(1);
}

const supabase = createClient(url, key, { auth: { persistSession: false } });

/** Recursively collect every object path in the bucket (folders have id === null). */
async function listAll(prefix) {
  const out = [];
  const limit = 1000;
  let offset = 0;
  while (true) {
    const { data, error } = await supabase.storage.from(BUCKET)
      .list(prefix, { limit, offset, sortBy: { column: 'name', order: 'asc' } });
    if (error) {
      const message = String(error.message || '');
      if (/not found|does not exist/i.test(message)) return out; // bucket absent → nothing to purge
      throw error;
    }
    if (!data?.length) break;
    for (const entry of data) {
      const fullPath = prefix ? `${prefix}/${entry.name}` : entry.name;
      if (entry.id === null) out.push(...await listAll(fullPath));
      else out.push(fullPath);
    }
    if (data.length < limit) break;
    offset += limit;
    if (offset > 100000) throw new Error('Storage listing exceeded the safe scan limit');
  }
  return out;
}

const objects = await listAll('');
if (objects.length === 0) {
  console.log(`Bucket "${BUCKET}" is empty or already gone — nothing to purge.`);
} else {
  console.log(`Purging ${objects.length} object(s) from "${BUCKET}"...`);
  for (let index = 0; index < objects.length; index += 100) {
    const batch = objects.slice(index, index + 100);
    const { error } = await supabase.storage.from(BUCKET).remove(batch);
    if (error) throw error;
    console.log(`  removed ${Math.min(index + batch.length, objects.length)}/${objects.length}`);
  }
}

const { error: bucketError } = await supabase.storage.deleteBucket(BUCKET);
if (bucketError) {
  const message = String(bucketError.message || '');
  if (/not found/i.test(message)) {
    console.log(`Bucket "${BUCKET}" already deleted.`);
  } else if (/not empty/i.test(message)) {
    console.error(`Bucket "${BUCKET}" still has objects — re-run this script.`);
    process.exit(1);
  } else {
    throw bucketError;
  }
} else {
  console.log(`Bucket "${BUCKET}" deleted. Storage space is now freed.`);
}
console.log('Done.');
