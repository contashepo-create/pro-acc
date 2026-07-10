/**
 * Safe version - uses env vars, no hardcoded secrets
 * Usage: SUPABASE_URL=... SUPABASE_SERVICE_ROLE_KEY=... node scripts/add-supabase-columns.mjs
 */
const SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
const BASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL || process.env.SUPABASE_URL;

if (!SERVICE_KEY || !BASE_URL) {
  console.error('❌ Missing SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY env vars');
  console.log('Run: SUPABASE_URL=your_url SUPABASE_SERVICE_ROLE_KEY=your_key node scripts/add-supabase-columns.mjs');
  process.exit(1);
}

async function run() {
  const createFnRes = await fetch(BASE_URL + '/rest/v1/rpc/exec_sql', {
    method: 'POST',
    headers: {
      'apikey': SERVICE_KEY,
      'Authorization': 'Bearer ' + SERVICE_KEY,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ sql: 'SELECT 1' }),
  });
  
  const fnData = await createFnRes.json();
  
  if (createFnRes.ok || (fnData.code && fnData.code !== 'PGRST202')) {
    console.log('exec_sql function may exist, trying...');
  } else {
    console.log('exec_sql RPC function does not exist on Supabase.');
    console.log('You need to run this SQL in Supabase Dashboard > SQL Editor:');
    console.log('---');
    console.log(`
ALTER TABLE users ADD COLUMN IF NOT EXISTS email_verified BOOLEAN DEFAULT false;
ALTER TABLE users ADD COLUMN IF NOT EXISTS email_verification_token TEXT;
ALTER TABLE users ADD COLUMN IF NOT EXISTS email_verification_expires TIMESTAMPTZ;
ALTER TABLE users ADD COLUMN IF NOT EXISTS last_activity TIMESTAMPTZ DEFAULT NOW();
UPDATE users SET email_verified = true WHERE email_verified IS NULL;
    `);
    console.log('---');
  }
}

run().catch(console.error);
