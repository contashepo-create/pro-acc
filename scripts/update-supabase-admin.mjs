// Update or create admin user on Supabase via REST API
// Usage: node scripts/update-supabase-admin.mjs (reads from .env.local)
import { scryptSync, randomBytes } from 'crypto';
import { config } from 'dotenv';
config({ path: '.env.local' });

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL;
const SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;

const ADMIN_EMAIL = process.env.ADMIN_EMAIL;
const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD;
const ADMIN_MASTER_PASSWORD = process.env.ADMIN_MASTER_PASSWORD || ADMIN_PASSWORD;
const TELEGRAM_CHAT_ID = process.env.TELEGRAM_ADMIN_CHAT_ID;
const TELEGRAM_BOT_TOKEN = process.env.TELEGRAM_BOT_TOKEN;
const ADMIN_NAME = process.env.ADMIN_NAME || 'مدير النظام';

if (!SUPABASE_URL || !SERVICE_KEY || !ADMIN_EMAIL || !ADMIN_PASSWORD) {
  console.error('❌ Required env vars: NEXT_PUBLIC_SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, ADMIN_EMAIL, ADMIN_PASSWORD');
  process.exit(1);
}

function hashPassword(password: string) {
  const salt = randomBytes(32).toString('hex');
  const derivedKey = scryptSync(password, salt, 64);
  return salt + ':' + derivedKey.toString('hex');
}

async function run() {
  const passwordHash = hashPassword(ADMIN_PASSWORD);
  const masterHash = hashPassword(ADMIN_MASTER_PASSWORD);

  const headers = {
    'apikey': SERVICE_KEY,
    'Authorization': `Bearer ${SERVICE_KEY}`,
    'Content-Type': 'application/json',
    'Prefer': 'return=representation',
  };

  const checkRes = await fetch(`${SUPABASE_URL}/rest/v1/admin_users?select=id`, { headers });
  const existing = await checkRes.json();

  const payload = {
    email: ADMIN_EMAIL,
    password_hash: passwordHash,
    master_password_hash: masterHash,
    telegram_chat_id: TELEGRAM_CHAT_ID,
    telegram_bot_token: TELEGRAM_BOT_TOKEN,
    name: ADMIN_NAME,
    is_active: true,
  };

  if (existing.length > 0) {
    const updateRes = await fetch(`${SUPABASE_URL}/rest/v1/admin_users?id=eq.${existing[0].id}`, {
      method: 'PATCH',
      headers,
      body: JSON.stringify(payload),
    });
    const updated = await updateRes.json();
    console.log('✓ Admin updated:', JSON.stringify(updated, null, 2));
  } else {
    const insertRes = await fetch(`${SUPABASE_URL}/rest/v1/admin_users`, {
      method: 'POST',
      headers,
      body: JSON.stringify(payload),
    });
    const inserted = await insertRes.json();
    console.log('✓ Admin created:', JSON.stringify(inserted, null, 2));
  }
}

run().catch(err => { console.error('Failed:', err); process.exit(1); });
