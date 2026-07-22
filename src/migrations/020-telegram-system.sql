-- Migration: 020-telegram-system.sql
-- Description: Creates tables and columns to support advanced multi-tenant Telegram Bot notifications, 2FA, approvals, and test-runs.

-- 1. Create company Telegram configurations table
CREATE TABLE IF NOT EXISTS company_telegram_configs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id UUID NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
  chat_id TEXT, -- User/Company telegram chat ID or group ID
  is_enabled BOOLEAN NOT NULL DEFAULT false,
  
  -- Notification settings
  notify_invoices BOOLEAN NOT NULL DEFAULT true,
  notify_cash_transactions BOOLEAN NOT NULL DEFAULT true,
  notify_user_logins BOOLEAN NOT NULL DEFAULT true,
  
  -- Approvals settings
  approvals_enabled BOOLEAN NOT NULL DEFAULT false,
  approval_threshold NUMERIC(15,2) NOT NULL DEFAULT 5000.00, -- Apply approvals only if amount > threshold
  
  -- Reset sessions
  reset_session_data JSONB,
  
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE(company_id)
);

CREATE INDEX IF NOT EXISTS idx_company_telegram_company_id ON company_telegram_configs(company_id);

-- 2. Create Telegram actions log table for usage limits (monthly rate limits)
CREATE TABLE IF NOT EXISTS telegram_actions_log (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id UUID NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
  action_type TEXT NOT NULL, -- 'notification_invoice', 'notification_cash', 'approval_sent', 'approval_action'
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_telegram_actions_log_company ON telegram_actions_log(company_id, created_at);

-- 3. Create Telegram Test Runs table to track real-time test button interactions
CREATE TABLE IF NOT EXISTS telegram_test_runs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id UUID NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
  status TEXT NOT NULL CHECK(status IN ('pending', 'accepted', 'rejected', 'expired')) DEFAULT 'pending',
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_telegram_test_runs_company ON telegram_test_runs(company_id);

-- 4. Enable Row Level Security (RLS) on new tables
ALTER TABLE company_telegram_configs ENABLE ROW LEVEL SECURITY;
ALTER TABLE telegram_actions_log ENABLE ROW LEVEL SECURITY;
ALTER TABLE telegram_test_runs ENABLE ROW LEVEL SECURITY;

-- 5. Add custom column or update fields in subscription_plans (using JSONB features_modules)
-- The columns max_users, max_projects, etc., already exist in subscription_plans.
-- We can add a monthly rate limit column for telegram actions or handle it via JSONB.
-- Let's make sure the default trial and basic plans have some features in the database if seeded.
