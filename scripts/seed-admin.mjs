import { query } from './src/lib/db';
import { scryptSync, randomBytes } from 'crypto';

async function hashPassword(password) {
  const salt = randomBytes(32).toString('hex');
  const derivedKey = scryptSync(password, salt, 64);
  return salt + ':' + derivedKey.toString('hex');
}

async function seed() {
  const existing = await query('SELECT id FROM admin_users LIMIT 1');
  if (existing.rows.length > 0) {
    console.log('Admin user already exists, skipping seed.');
    process.exit(0);
  }

  const ADMIN_EMAIL = process.env.ADMIN_EMAIL || 'zerocold@admin.com';
  const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD || 'admin123';
  const ADMIN_MASTER_PASSWORD = process.env.ADMIN_MASTER_PASSWORD || ADMIN_PASSWORD;
  const TELEGRAM_CHAT_ID = process.env.TELEGRAM_ADMIN_CHAT_ID || '';
  const TELEGRAM_BOT_TOKEN = process.env.TELEGRAM_BOT_TOKEN || '';
  const ADMIN_NAME = process.env.ADMIN_NAME || 'مدير النظام';

  if (!TELEGRAM_BOT_TOKEN || !TELEGRAM_CHAT_ID) {
    console.warn('⚠️  TELEGRAM_BOT_TOKEN or TELEGRAM_ADMIN_CHAT_ID not set. 2FA will not work.');
  }

  const passwordHash = await hashPassword(ADMIN_PASSWORD);
  const masterHash = await hashPassword(ADMIN_MASTER_PASSWORD);

  await query(
    `INSERT INTO admin_users (email, password_hash, master_password_hash, telegram_chat_id, telegram_bot_token, name)
     VALUES ($1, $2, $3, $4, $5, $6)`,
    [ADMIN_EMAIL, passwordHash, masterHash, TELEGRAM_CHAT_ID, TELEGRAM_BOT_TOKEN, ADMIN_NAME]
  );

  console.log(`✓ Admin user created: ${ADMIN_EMAIL}`);
  console.log('  Set passwords via ADMIN_PASSWORD and ADMIN_MASTER_PASSWORD env vars');
  process.exit(0);
}

seed().catch((err) => {
  console.error('Seed failed:', err);
  process.exit(1);
});
