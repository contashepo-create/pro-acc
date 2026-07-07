// Add columns to Supabase via the management API
// Supabase doesn't expose DDL via REST, so we use the SQL endpoint
const SERVICE_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InZtemNlanRhdGtnbWVtd2xiaHRrIiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImlhdCI6MTc4MjE1NzY1MiwiZXhwIjoyMDk3NzMzNjUyfQ.2Nelui57BCS8LWnGGYyQ4ZdMSGa21EEa9b1kwEcCW2w';
const BASE_URL = 'https://vmzcejtatkgmemwlbhtk.supabase.co';

// We can't run DDL via REST API. But we can try to INSERT/UPDATE directly
// since the service role key bypasses RLS.

async function addColumnsViaInsert() {
  // Try updating users table to add email_verified=true for existing users
  // This will fail if column doesn't exist, confirming we need manual SQL
  const res = await fetch(BASE_URL + '/rest/v1/users?select=id,email', {
    headers: { 'apikey': SERVICE_KEY, 'Authorization': 'Bearer ' + SERVICE_KEY }
  });
  const data = await res.json();
  
  if (res.ok && Array.isArray(data)) {
    console.log(`Found ${data.length} users in Supabase`);
    
    // Try to PATCH a user with email_verified field
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
