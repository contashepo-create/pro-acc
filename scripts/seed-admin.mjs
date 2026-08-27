// Seed the first admin user.
//
// The per-admin Telegram bot token is stored ENCRYPTED (enc:v1: envelope,
// AES-256-GCM) — see scripts/lib/telegram-token-crypto.mjs. The data
// encryption key comes from the TELEGRAM_TOKEN_KEY env var (64 hex chars,
// e.g. `openssl rand -hex 32`). Without it the token column is left NULL
// and the global TELEGRAM_BOT_TOKEN env var remains the bot source.
import { Pool } from 'pg';
import { scryptSync, randomBytes } from 'crypto';
import { config } from 'dotenv';
import { encryptTelegramToken } from './lib/telegram-token-crypto.mjs';

config({ path: '.env.local' });

const connectionString = (process.env.DATABASE_URL || '').replace(/^\uFEFF/, '').trim();
// Mirror src/lib/db.ts TLS policy: Supabase connections must be encrypted;
// production refuses to start without a CA cert.
let sslConfig;
if (connectionString.includes('supabase')) {
  if (process.env.DATABASE_CA_CERT) {
    sslConfig = { rejectUnauthorized: true, ca: process.env.DATABASE_CA_CERT };
  } else {
    if (process.env.NODE_ENV === 'production') {
      throw new Error('DATABASE_CA_CERT must be set in production for Supabase TLS verification');
    }
    sslConfig = { rejectUnauthorized: false };
    console.warn('⚠️ DATABASE_CA_CERT not set; TLS verification disabled (dev only).');
  }
}
const pool = new Pool({ connectionString, ssl: sslConfig });

async function hashPassword(password) {
  const salt = randomBytes(32).toString('hex');
  const derivedKey = scryptSync(password, salt, 64);
  return salt + ':' + derivedKey.toString('hex');
}

function storeToken(token) {
  if (!token) return null;
  try {
    return encryptTelegramToken(token);
  } catch (e) {
    console.warn('⚠️', e.message);
    console.warn('   Leaving telegram_bot_token NULL; the global TELEGRAM_BOT_TOKEN env var still works.');
    return null;
  }
}

async function seed() {
  const existing = await pool.query('SELECT id FROM admin_users LIMIT 1');
  if (existing.rows.length > 0) {
    console.log('Admin user already exists, skipping seed.');
    process.exit(0);
  }

  const ADMIN_EMAIL = process.env.ADMIN_EMAIL;
  const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD;
  const ADMIN_MASTER_PASSWORD = process.env.ADMIN_MASTER_PASSWORD || ADMIN_PASSWORD;
  const TELEGRAM_CHAT_ID = process.env.TELEGRAM_ADMIN_CHAT_ID;
  const TELEGRAM_BOT_TOKEN = process.env.TELEGRAM_BOT_TOKEN;
  const ADMIN_NAME = process.env.ADMIN_NAME || 'مدير النظام';

  if (!ADMIN_EMAIL || !ADMIN_PASSWORD) {
    console.error('❌ ADMIN_EMAIL and ADMIN_PASSWORD environment variables are required.');
    console.error('   Example: ADMIN_EMAIL=admin@example.com ADMIN_PASSWORD=yourpassword node scripts/seed-admin.mjs');
    process.exit(1);
  }

  if (!TELEGRAM_BOT_TOKEN || !TELEGRAM_CHAT_ID) {
    console.warn('⚠️  TELEGRAM_BOT_TOKEN or TELEGRAM_ADMIN_CHAT_ID not set. 2FA will not work.');
  }

  const passwordHash = await hashPassword(ADMIN_PASSWORD);
  const masterHash = await hashPassword(ADMIN_MASTER_PASSWORD);
  const tokenToStore = storeToken(TELEGRAM_BOT_TOKEN);

  await pool.query(
    `INSERT INTO admin_users (email, password_hash, master_password_hash, telegram_chat_id, telegram_bot_token, name)
     VALUES ($1, $2, $3, $4, $5, $6)`,
    [ADMIN_EMAIL, passwordHash, masterHash, TELEGRAM_CHAT_ID, tokenToStore, ADMIN_NAME]
  );

  console.log(`✓ Admin user created: ${ADMIN_EMAIL}`);
  await pool.end();
  process.exit(0);
}

seed().catch((err) => {
  console.error('Seed failed:', err);
  process.exit(1);
});
