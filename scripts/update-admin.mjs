import { Pool } from 'pg';
import { scryptSync, randomBytes } from 'crypto';
import { config } from 'dotenv';
config({ path: '.env.local' });

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: false,
});

async function hashPassword(password: string) {
  const salt = randomBytes(32).toString('hex');
  const derivedKey = scryptSync(password, salt, 64);
  return salt + ':' + derivedKey.toString('hex');
}

async function update() {
  const ADMIN_EMAIL = process.env.ADMIN_EMAIL;
  const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD;
  const ADMIN_MASTER_PASSWORD = process.env.ADMIN_MASTER_PASSWORD || ADMIN_PASSWORD;
  const TELEGRAM_CHAT_ID = process.env.TELEGRAM_ADMIN_CHAT_ID;
  const TELEGRAM_BOT_TOKEN = process.env.TELEGRAM_BOT_TOKEN;
  const ADMIN_NAME = process.env.ADMIN_NAME || 'مدير النظام';

  if (!ADMIN_EMAIL || !ADMIN_PASSWORD) {
    console.error('❌ ADMIN_EMAIL and ADMIN_PASSWORD env vars are required.');
    process.exit(1);
  }

  const passwordHash = await hashPassword(ADMIN_PASSWORD);
  const masterHash = await hashPassword(ADMIN_MASTER_PASSWORD);

  const existing = await pool.query('SELECT id FROM admin_users LIMIT 1');
  if (existing.rows.length === 0) {
    await pool.query(
      `INSERT INTO admin_users (email, password_hash, master_password_hash, telegram_chat_id, telegram_bot_token, name)
       VALUES ($1, $2, $3, $4, $5, $6)`,
      [ADMIN_EMAIL, passwordHash, masterHash, TELEGRAM_CHAT_ID, TELEGRAM_BOT_TOKEN, ADMIN_NAME]
    );
    console.log(`✓ Admin user created: ${ADMIN_EMAIL}`);
  } else {
    await pool.query(
      `UPDATE admin_users SET email = $1, password_hash = $2, master_password_hash = $3, telegram_chat_id = $4, telegram_bot_token = $5, name = $6`,
      [ADMIN_EMAIL, passwordHash, masterHash, TELEGRAM_CHAT_ID, TELEGRAM_BOT_TOKEN, ADMIN_NAME]
    );
    console.log(`✓ Admin user updated: ${ADMIN_EMAIL}`);
  }
  await pool.end();
}

update().catch((err) => {
  console.error('Update failed:', err);
  process.exit(1);
});
