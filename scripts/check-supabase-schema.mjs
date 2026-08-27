/**
 * Safe version - uses env vars, no hardcoded secrets
 * Usage: SUPABASE_URL=... SUPABASE_SERVICE_ROLE_KEY=... node scripts/check-supabase-schema.mjs
 */
const SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
const BASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL || process.env.SUPABASE_URL;

if (!SERVICE_KEY || !BASE_URL) {
  console.error('❌ Missing SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY env vars');
  process.exit(1);
}

async function addColumnsViaInsert() {
  const res = await fetch(BASE_URL + '/rest/v1/users?select=id,email', {
    headers: { 'apikey': SERVICE_KEY, 'Authorization': 'Bearer ' + SERVICE_KEY }
  });
  const data = await res.json();
  
  if (res.ok && Array.isArray(data)) {
    console.log(`Found ${data.length} users in Supabase`);
    
    if (data.length > 0) {
      const patchRes = await fetch(BASE_URL + '/rest/v1/users?id=eq.' + data[0].id, {
        method: 'PATCH',
        headers: {
          'apikey': SERVICE_KEY,
          'Authorization': 'Bearer ' + SERVICE_KEY,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ email_verified: true }),
      });
      
      if (patchRes.ok) {
        console.log('email_verified column EXISTS and works!');
      } else {
        const patchData = await patchRes.json();
        console.log('email_verified column MISSING:');
        console.log(patchData.message || JSON.stringify(patchData));
        console.log('\nPlease run this SQL in Supabase Dashboard > SQL Editor:\n');
        console.log(`ALTER TABLE users ADD COLUMN IF NOT EXISTS email_verified BOOLEAN DEFAULT false;
ALTER TABLE users ADD COLUMN IF NOT EXISTS email_verification_token TEXT;
ALTER TABLE users ADD COLUMN IF NOT EXISTS email_verification_expires TIMESTAMPTZ;
ALTER TABLE users ADD COLUMN IF NOT EXISTS last_activity TIMESTAMPTZ DEFAULT NOW();
UPDATE users SET email_verified = true WHERE email_verified IS NULL OR email_verified = false;
ALTER TABLE subscription_plans ADD COLUMN IF NOT EXISTS duration_type TEXT DEFAULT 'monthly';`);
      }
    } else {
      console.log('No users found - registering a new user will create them with the correct schema IF the migration has been run');
      console.log('Please run this SQL in Supabase Dashboard > SQL Editor:\n');
      console.log(`ALTER TABLE users ADD COLUMN IF NOT EXISTS email_verified BOOLEAN DEFAULT false;
ALTER TABLE users ADD COLUMN IF NOT EXISTS email_verification_token TEXT;
ALTER TABLE users ADD COLUMN IF NOT EXISTS email_verification_expires TIMESTAMPTZ;
ALTER TABLE users ADD COLUMN IF NOT EXISTS last_activity TIMESTAMPTZ DEFAULT NOW();
ALTER TABLE subscription_plans ADD COLUMN IF NOT EXISTS duration_type TEXT DEFAULT 'monthly';`);
    }
  } else {
    console.log('Error querying users:', JSON.stringify(data));
  }
}

addColumnsViaInsert().catch(console.error);
