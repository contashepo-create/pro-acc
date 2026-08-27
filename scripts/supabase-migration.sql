-- Run this in Supabase Dashboard > SQL Editor
-- Adds email verification and activity tracking columns

ALTER TABLE users ADD COLUMN IF NOT EXISTS email_verified BOOLEAN DEFAULT false;
ALTER TABLE users ADD COLUMN IF NOT EXISTS email_verification_token TEXT;
ALTER TABLE users ADD COLUMN IF NOT EXISTS email_verification_expires TIMESTAMPTZ;
ALTER TABLE users ADD COLUMN IF NOT EXISTS last_activity TIMESTAMPTZ DEFAULT NOW();

-- Make existing users verified (so they can still login)
UPDATE users SET email_verified = true WHERE email_verified IS NULL OR email_verified = false;

-- Add duration_type to subscription_plans for daily/monthly/yearly support
ALTER TABLE subscription_plans ADD COLUMN IF NOT EXISTS duration_type TEXT DEFAULT 'monthly' CHECK(duration_type IN ('daily', 'monthly', 'yearly'));
