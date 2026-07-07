const SERVICE_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InZtemNlanRhdGtnbWVtd2xiaHRrIiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImlhdCI6MTc4MjE1NzY1MiwiZXhwIjoyMDk3NzMzNjUyfQ.2Nelui57BCS8LWnGGYyQ4ZdMSGa21EEa9b1kwEcCW2w';
const BASE_URL = 'https://vmzcejtatkgmemwlbhtk.supabase.co';

async function run() {
  // Try to add columns via RPC (Supabase doesn't support DDL via REST API)
  // We need to use the pg_dump approach or create a function
  
  // First, try creating a function to execute DDL
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
    // Function exists or error is not "not found"
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

-- Make existing users verified (so they can still login)
UPDATE users SET email_verified = true WHERE email_verified IS NULL;

-- Create subscription plan durations
-- duration_days already supports daily (1), monthly (30), yearly (365)
    `);
    console.log('---');
    console.log('Copy and paste the SQL above into Supabase Dashboard > SQL Editor and click Run');
  }
}

run().catch(console.error);
