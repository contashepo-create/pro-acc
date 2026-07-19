-- Add additional fields to users table for company users
ALTER TABLE users ADD COLUMN IF NOT EXISTS phone TEXT;
ALTER TABLE users ADD COLUMN IF NOT EXISTS birth_date DATE;
ALTER TABLE users ADD COLUMN IF NOT EXISTS city TEXT;

-- Create index for faster lookups
CREATE INDEX IF NOT EXISTS idx_users_phone ON users(phone);
CREATE INDEX IF NOT EXISTS idx_users_city ON users(city);

-- Update any existing subscription plans to ensure max_users is set
UPDATE subscription_plans SET max_users = 1 WHERE max_users IS NULL;
UPDATE subscription_plans SET max_users = 3 WHERE code = 'basic' AND max_users = 1;
UPDATE subscription_plans SET max_users = 10 WHERE code = 'professional' AND max_users = 1;
UPDATE subscription_plans SET max_users = 999 WHERE code = 'enterprise' AND max_users = 1;
