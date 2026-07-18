-- Migration 016: Approval System for Telegram Bot Notifications

-- جدول تتبع طلبات الموافقة
CREATE TABLE IF NOT EXISTS approval_requests (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id UUID NOT NULL REFERENCES companies(id),
  transaction_type TEXT NOT NULL,
  transaction_id TEXT NOT NULL,
  amount NUMERIC(15,2) NOT NULL,
  requester_id UUID NOT NULL REFERENCES users(id),
  approver_chat_id TEXT,
  status TEXT DEFAULT 'pending' CHECK(status IN ('pending', 'approved', 'rejected', 'cancelled')),
  message TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  approved_at TIMESTAMPTZ
);

-- فهارس للأداء
CREATE INDEX IF NOT EXISTS idx_approval_requests_company ON approval_requests(company_id);
CREATE INDEX IF NOT EXISTS idx_approval_requests_status ON approval_requests(status);
CREATE INDEX IF NOT EXISTS idx_approval_requests_transaction ON approval_requests(transaction_type, transaction_id);
CREATE INDEX IF NOT EXISTS idx_approval_requests_requester ON approval_requests(requester_id);

-- إضافة عمود status لبعض الجداول لدعم الرفض
ALTER TABLE voucher_disbursements ADD COLUMN IF NOT EXISTS status TEXT DEFAULT 'approved';
ALTER TABLE voucher_receipts ADD COLUMN IF NOT EXISTS status TEXT DEFAULT 'approved';
ALTER TABLE cash_transactions ADD COLUMN IF NOT EXISTS status TEXT DEFAULT 'approved';

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
