-- Migration 016: Approval System for Telegram Bot Notifications
--
-- NOTE: Migration 017 originally also issued a CREATE TABLE IF NOT EXISTS
-- approval_requests with a different shape (entity_type / entity_id /
-- approver_id / ...). The merged shape below creates the UNIFIED table
-- that covers BOTH the telegram-flow columns (transaction_type /
-- transaction_id) AND the 017 approvals API columns (entity_type /
-- entity_id / approver_id / updated_at / ...) up-front, so there is no
-- CREATE TABLE conflict and no missing column errors for code that
-- assumes either shape.

-- جدول تتبع طلبات الموافقة (الشكل الموحد)
CREATE TABLE IF NOT EXISTS approval_requests (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id UUID NOT NULL REFERENCES companies(id),

  -- 016 telegram-notification shape
  transaction_type TEXT,
  transaction_id   TEXT,
  amount           NUMERIC(15,2),
  requester_id     UUID REFERENCES users(id),
  approver_chat_id TEXT,
  message          TEXT,
  approved_at      TIMESTAMPTZ,

  -- 017 approvals API shape
  entity_type       TEXT,
  entity_id         UUID,
  description       TEXT,
  approver_id       UUID REFERENCES users(id),
  approved_by       UUID REFERENCES users(id),
  approval_comments TEXT,
  updated_at        TIMESTAMPTZ DEFAULT NOW(),

  status TEXT DEFAULT 'pending' CHECK(status IN ('pending', 'approved', 'rejected', 'cancelled')),
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- في حال كان الجدول موجوداً مسبقاً بالشكل القديم، نضيف الأعمدة الناقصة.
ALTER TABLE approval_requests ADD COLUMN IF NOT EXISTS transaction_type TEXT;
ALTER TABLE approval_requests ADD COLUMN IF NOT EXISTS transaction_id   TEXT;
ALTER TABLE approval_requests ADD COLUMN IF NOT EXISTS amount           NUMERIC(15,2);
ALTER TABLE approval_requests ADD COLUMN IF NOT EXISTS requester_id     UUID REFERENCES users(id);
ALTER TABLE approval_requests ADD COLUMN IF NOT EXISTS approver_chat_id TEXT;
ALTER TABLE approval_requests ADD COLUMN IF NOT EXISTS message          TEXT;
ALTER TABLE approval_requests ADD COLUMN IF NOT EXISTS approved_at      TIMESTAMPTZ;

ALTER TABLE approval_requests ADD COLUMN IF NOT EXISTS entity_type       TEXT;
ALTER TABLE approval_requests ADD COLUMN IF NOT EXISTS entity_id         UUID;
ALTER TABLE approval_requests ADD COLUMN IF NOT EXISTS description       TEXT;
ALTER TABLE approval_requests ADD COLUMN IF NOT EXISTS approver_id       UUID REFERENCES users(id);
ALTER TABLE approval_requests ADD COLUMN IF NOT EXISTS approved_by       UUID REFERENCES users(id);
ALTER TABLE approval_requests ADD COLUMN IF NOT EXISTS approval_comments TEXT;
ALTER TABLE approval_requests ADD COLUMN IF NOT EXISTS updated_at        TIMESTAMPTZ DEFAULT NOW();

-- فهارس للأداء (تُنشأ بشكل آمن إذا لم تكن موجودة)
CREATE INDEX IF NOT EXISTS idx_approval_requests_company   ON approval_requests(company_id);
CREATE INDEX IF NOT EXISTS idx_approval_requests_status    ON approval_requests(status);
CREATE INDEX IF NOT EXISTS idx_approval_requests_requester ON approval_requests(requester_id);

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_indexes
     WHERE schemaname = 'public' AND indexname = 'idx_approval_requests_transaction'
  ) THEN
    CREATE INDEX idx_approval_requests_transaction
      ON approval_requests(transaction_type, transaction_id);
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM pg_indexes
     WHERE schemaname = 'public' AND indexname = 'idx_approval_requests_entity'
  ) THEN
    CREATE INDEX idx_approval_requests_entity
      ON approval_requests(entity_type, entity_id);
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM pg_indexes
     WHERE schemaname = 'public' AND indexname = 'idx_approval_requests_approver'
  ) THEN
    CREATE INDEX idx_approval_requests_approver
      ON approval_requests(approver_id);
  END IF;
END $$;

-- Backfill: لضمان أن السجلات القديمة تظهر في كلا المسارين
UPDATE approval_requests
   SET transaction_type = entity_type,
       transaction_id   = entity_id::TEXT
 WHERE entity_type IS NOT NULL
   AND (transaction_type IS NULL OR transaction_id IS NULL);

-- إضافة عمود status لبعض الجداول لدعم الرفض
ALTER TABLE voucher_disbursements ADD COLUMN IF NOT EXISTS status TEXT DEFAULT 'approved';
ALTER TABLE voucher_receipts      ADD COLUMN IF NOT EXISTS status TEXT DEFAULT 'approved';
ALTER TABLE cash_transactions     ADD COLUMN IF NOT EXISTS status TEXT DEFAULT 'approved';

-- جدول إعدادات تيليجرام للشركات (إذا لم يكن موجوداً)
CREATE TABLE IF NOT EXISTS company_telegram_configs (
  company_id UUID PRIMARY KEY REFERENCES companies(id),
  chat_id TEXT NOT NULL DEFAULT '',
  is_enabled BOOLEAN DEFAULT false,
  notify_invoices BOOLEAN DEFAULT true,
  notify_cash_transactions BOOLEAN DEFAULT true,
  notify_user_logins BOOLEAN DEFAULT true,
  approvals_enabled BOOLEAN DEFAULT false,
  approval_threshold NUMERIC(15,2) DEFAULT 5000.00,
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- إدخال إعدادات افتراضية للشركات الموجودة
INSERT INTO company_telegram_configs (company_id, is_enabled, approvals_enabled, approval_threshold)
SELECT id, false, false, 5000.00
FROM companies
ON CONFLICT (company_id) DO NOTHING;
