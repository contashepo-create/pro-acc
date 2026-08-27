-- 065 - Repair the additional-user voucher approval prerequisites.
--
-- The sole company admin bypasses Telegram confirmation, while additional
-- users read company_telegram_configs and can enter the pending approval path.
-- Historical/partially-applied installations can therefore work for the admin
-- but fail with a generic 500 only for additional users when one optional
-- config column is absent or approval_requests came from migration 017's
-- stricter shape (approver_id NOT NULL).
--
-- Keep the policy fail-closed: a requester does not choose an approver when the
-- voucher is created. The admin/Telegram identity is validated when responding.

ALTER TABLE company_telegram_configs
  ADD COLUMN IF NOT EXISTS chat_id TEXT NOT NULL DEFAULT '',
  ADD COLUMN IF NOT EXISTS is_enabled BOOLEAN NOT NULL DEFAULT FALSE,
  ADD COLUMN IF NOT EXISTS approvals_enabled BOOLEAN NOT NULL DEFAULT FALSE,
  ADD COLUMN IF NOT EXISTS approval_threshold NUMERIC(15,2) NOT NULL DEFAULT 5000.00;

ALTER TABLE user_permissions
  ADD COLUMN IF NOT EXISTS bypass_telegram_confirmation BOOLEAN NOT NULL DEFAULT FALSE;

ALTER TABLE approval_requests
  ADD COLUMN IF NOT EXISTS transaction_type TEXT,
  ADD COLUMN IF NOT EXISTS transaction_id TEXT,
  ADD COLUMN IF NOT EXISTS amount NUMERIC(15,2),
  ADD COLUMN IF NOT EXISTS requester_id UUID REFERENCES users(id),
  ADD COLUMN IF NOT EXISTS approver_chat_id TEXT,
  ADD COLUMN IF NOT EXISTS message TEXT,
  ADD COLUMN IF NOT EXISTS approved_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS entity_type TEXT,
  ADD COLUMN IF NOT EXISTS entity_id UUID,
  ADD COLUMN IF NOT EXISTS description TEXT,
  ADD COLUMN IF NOT EXISTS approver_id UUID REFERENCES users(id),
  ADD COLUMN IF NOT EXISTS approved_by UUID REFERENCES users(id),
  ADD COLUMN IF NOT EXISTS approval_comments TEXT,
  ADD COLUMN IF NOT EXISTS updated_at TIMESTAMPTZ DEFAULT NOW();

-- Migration 017 originally required approver_id at request creation. Voucher
-- approvals deliberately resolve and authorize the approver at decision time.
ALTER TABLE approval_requests ALTER COLUMN approver_id DROP NOT NULL;

-- Normalize nullable values left by older table variants without weakening the
-- control: NULL/negative thresholds disable automatic threshold triggering;
-- lookup failures in application code still hold vouchers as pending.
UPDATE company_telegram_configs
SET chat_id = COALESCE(chat_id, ''),
    is_enabled = COALESCE(is_enabled, FALSE),
    approvals_enabled = COALESCE(approvals_enabled, FALSE),
    approval_threshold = GREATEST(COALESCE(approval_threshold, 0), 0)
WHERE chat_id IS NULL
   OR is_enabled IS NULL
   OR approvals_enabled IS NULL
   OR approval_threshold IS NULL
   OR approval_threshold < 0;

ALTER TABLE company_telegram_configs
  ALTER COLUMN chat_id SET DEFAULT '',
  ALTER COLUMN chat_id SET NOT NULL,
  ALTER COLUMN is_enabled SET DEFAULT FALSE,
  ALTER COLUMN is_enabled SET NOT NULL,
  ALTER COLUMN approvals_enabled SET DEFAULT FALSE,
  ALTER COLUMN approvals_enabled SET NOT NULL,
  ALTER COLUMN approval_threshold SET DEFAULT 5000.00,
  ALTER COLUMN approval_threshold SET NOT NULL;
