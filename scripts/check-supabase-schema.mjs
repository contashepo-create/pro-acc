const SERVICE_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InZtemNlanRhdGtnbWVtd2xiaHRrIiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImlhdCI6MTc4MjE1NzY1MiwiZXhwIjoyMDk3NzMzNjUyfQ.2Nelui57BCS8LWnGGYyQ4ZdMSGa21EEa9b1kwEcCW2w';
const BASE_URL = 'https://vmzcejtatkgmemwlbhtk.supabase.co';

async function run() {
  // Check if users table has email_verified column
  const res = await fetch(BASE_URL + '/rest/v1/users?select=email_verified&limit=1', {
    headers: { 'apikey': SERVICE_KEY, 'Authorization': 'Bearer ' + SERVICE_KEY }
  });
  const data = await res.json();
  if (res.ok) {
    console.log('email_verified column EXISTS');
  } else {
    console.log('email_verified column MISSING:', JSON.stringify(data));
    console.log('Run this SQL in Supabase Dashboard > SQL Editor:');
    console.log(`
ALTER TABLE users ADD COLUMN IF NOT EXISTS email_verified BOOLEAN DEFAULT false;
ALTER TABLE users ADD COLUMN IF NOT EXISTS email_verification_token TEXT;
ALTER TABLE users ADD COLUMN IF NOT EXISTS email_verification_expires TIMESTAMPTZ;
ALTER TABLE users ADD COLUMN IF NOT EXISTS last_activity TIMESTAMPTZ DEFAULT NOW();
    `);
  }
}

run().catch(console.error);
