-- ============================================================
-- Migration 019: Fix Missing Tables and Columns
-- Date: 2026-07-23
-- Description: Ensure all tables from migrations 013-018 exist correctly
-- ============================================================

-- 1. boq_items (if not exists, create; if exists, add missing columns)
CREATE TABLE IF NOT EXISTS boq_items (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id UUID NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
  project_id UUID NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  item_code TEXT NOT NULL,
  description TEXT NOT NULL,
  unit TEXT NOT NULL DEFAULT 'وحدة',
  quantity NUMERIC NOT NULL DEFAULT 0,
  unit_price NUMERIC NOT NULL DEFAULT 0,
  total NUMERIC NOT NULL DEFAULT 0,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- Add item_code if table exists but column doesn't
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'boq_items' AND column_name = 'item_code'
  ) THEN
    ALTER TABLE boq_items ADD COLUMN IF NOT EXISTS item_code TEXT;
  END IF;
END $$;

-- Add total as regular column if it doesn't exist (avoid GENERATED issues)
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'boq_items' AND column_name = 'total'
  ) THEN
    ALTER TABLE boq_items ADD COLUMN IF NOT EXISTS total NUMERIC DEFAULT 0;
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS idx_boq_items_company ON boq_items(company_id);
CREATE INDEX IF NOT EXISTS idx_boq_items_project ON boq_items(project_id);

-- 2. progress_billing
CREATE TABLE IF NOT EXISTS progress_billing (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id UUID NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
  project_id UUID NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  claim_number TEXT NOT NULL,
  date DATE NOT NULL,
  description TEXT,
  gross_amount NUMERIC NOT NULL DEFAULT 0,
  retention_rate NUMERIC DEFAULT 0,
  retention_amount NUMERIC DEFAULT 0,
  net_amount NUMERIC DEFAULT 0,
  status TEXT DEFAULT 'approved',
  journal_entry_id UUID REFERENCES journal_entries(id) ON DELETE SET NULL,
  is_final BOOLEAN DEFAULT false,
  tax_rate NUMERIC DEFAULT 0,
  tax_amount NUMERIC DEFAULT 0,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  created_by UUID
);

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'progress_billing' AND column_name = 'is_final') THEN
    ALTER TABLE progress_billing ADD COLUMN IF NOT EXISTS is_final BOOLEAN DEFAULT false;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'progress_billing' AND column_name = 'tax_rate') THEN
    ALTER TABLE progress_billing ADD COLUMN IF NOT EXISTS tax_rate NUMERIC DEFAULT 0;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'progress_billing' AND column_name = 'tax_amount') THEN
    ALTER TABLE progress_billing ADD COLUMN IF NOT EXISTS tax_amount NUMERIC DEFAULT 0;
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS idx_progress_billing_company ON progress_billing(company_id);
CREATE INDEX IF NOT EXISTS idx_progress_billing_project ON progress_billing(project_id);

-- 3. quotations
CREATE TABLE IF NOT EXISTS quotations (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id UUID NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
  contact_id UUID REFERENCES contacts(id) ON DELETE SET NULL,
  project_id UUID REFERENCES projects(id) ON DELETE SET NULL,
  number TEXT NOT NULL,
  date DATE NOT NULL,
  valid_until DATE,
  status TEXT DEFAULT 'draft',
  subtotal NUMERIC DEFAULT 0,
  vat_rate NUMERIC DEFAULT 0,
  tax_rate NUMERIC DEFAULT 0,
  vat_amount NUMERIC DEFAULT 0,
  tax_amount NUMERIC DEFAULT 0,
  discount_amount NUMERIC DEFAULT 0,
  total NUMERIC DEFAULT 0,
  notes TEXT,
  terms TEXT,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  created_by UUID
);

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'quotations' AND column_name = 'tax_rate') THEN
    ALTER TABLE quotations ADD COLUMN IF NOT EXISTS tax_rate NUMERIC DEFAULT 0;
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS idx_quotations_company ON quotations(company_id);
CREATE INDEX IF NOT EXISTS idx_quotations_status ON quotations(status);

-- 4. quotation_items
CREATE TABLE IF NOT EXISTS quotation_items (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  quotation_id UUID NOT NULL REFERENCES quotations(id) ON DELETE CASCADE,
  description TEXT NOT NULL,
  quantity NUMERIC NOT NULL DEFAULT 0,
  unit_price NUMERIC NOT NULL DEFAULT 0,
  total NUMERIC DEFAULT 0,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_quotation_items_quotation ON quotation_items(quotation_id);

-- 5. project_expenses
CREATE TABLE IF NOT EXISTS project_expenses (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id UUID NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
  project_id UUID NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  expense_type TEXT NOT NULL,
  description TEXT NOT NULL,
  amount NUMERIC NOT NULL DEFAULT 0,
  date DATE NOT NULL,
  contact_id UUID REFERENCES contacts(id) ON DELETE SET NULL,
  account_code TEXT NOT NULL DEFAULT '5100',
  journal_entry_id UUID REFERENCES journal_entries(id) ON DELETE SET NULL,
  tax_rate NUMERIC DEFAULT 0,
  tax_amount NUMERIC DEFAULT 0,
  notes TEXT,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  created_by UUID
);

CREATE INDEX IF NOT EXISTS idx_project_expenses_company ON project_expenses(company_id);
CREATE INDEX IF NOT EXISTS idx_project_expenses_project ON project_expenses(project_id);

-- 6. Companies: add country/currency/vat columns
ALTER TABLE companies ADD COLUMN IF NOT EXISTS country TEXT DEFAULT 'السعودية';
ALTER TABLE companies ADD COLUMN IF NOT EXISTS country_code TEXT DEFAULT 'SA';
ALTER TABLE companies ADD COLUMN IF NOT EXISTS currency_code TEXT DEFAULT 'SAR';
ALTER TABLE companies ADD COLUMN IF NOT EXISTS locale TEXT DEFAULT 'ar-SA';
ALTER TABLE companies ADD COLUMN IF NOT EXISTS vat_rate NUMERIC DEFAULT 0.15;

-- 7. Projects: add closure + tax columns
ALTER TABLE projects ADD COLUMN IF NOT EXISTS closed_at TIMESTAMP WITH TIME ZONE;
ALTER TABLE projects ADD COLUMN IF NOT EXISTS closed_by UUID;
ALTER TABLE projects ADD COLUMN IF NOT EXISTS closure_journal_entry_id UUID;
ALTER TABLE projects ADD COLUMN IF NOT EXISTS tax_enabled BOOLEAN DEFAULT false;
ALTER TABLE projects ADD COLUMN IF NOT EXISTS tax_rate NUMERIC DEFAULT 0;

-- 8. Cash transactions: add tax columns
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_name = 'cash_transactions') THEN
    ALTER TABLE cash_transactions ADD COLUMN IF NOT EXISTS tax_rate NUMERIC DEFAULT 0;
    ALTER TABLE cash_transactions ADD COLUMN IF NOT EXISTS tax_amount NUMERIC DEFAULT 0;
  END IF;
END $$;

-- 9. Invoice items: add columns
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_name = 'invoice_items') THEN
    ALTER TABLE invoice_items ADD COLUMN IF NOT EXISTS barcode TEXT;
  END IF;
END $$;

-- 10. Inventory items: add barcode
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_name = 'inventory_items') THEN
    ALTER TABLE inventory_items ADD COLUMN IF NOT EXISTS barcode TEXT;
  END IF;
END $$;

-- 11. Ensure update_updated_at_column function exists
CREATE OR REPLACE FUNCTION update_updated_at_column()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- 12. app_settings table
CREATE TABLE IF NOT EXISTS app_settings (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  key TEXT NOT NULL UNIQUE,
  value TEXT,
  category TEXT DEFAULT 'general',
  is_public BOOLEAN DEFAULT true,
  updated_at TIMESTAMPTZ DEFAULT NOW(),
  updated_by UUID
);

INSERT INTO app_settings (key, value, category, is_public) VALUES
  ('app_name', 'برو أكاونت', 'branding', true),
  ('app_name_en', 'ProAccount', 'branding', true),
  ('app_version', '1.0.0', 'branding', true),
  ('developer_name', 'ContaShepo', 'branding', true),
  ('support_email', 'contashepo@gmail.com', 'contact', true),
  ('support_phone', '+966500000000', 'contact', true),
  ('support_whatsapp', '+966500000000', 'contact', true),
  ('support_telegram', 'contashepo', 'contact', true),
  ('support_website', 'https://pro-acc.vercel.app', 'contact', true),
  ('payment_info', 'يمكن الدفع عبر التحويل البنكي أو الوسائل الإلكترونية', 'payment', true),
  ('payment_bank_name', '', 'payment', true),
  ('payment_iban', '', 'payment', true),
  ('payment_stc_pay', '', 'payment', true),
  ('footer_text', '© 2026 برو أكاونت - جميع الحقوق محفوظة', 'branding', true)
ON CONFLICT (key) DO NOTHING;

-- 13. subscriber_number in subscriptions
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'subscriptions' AND column_name = 'subscriber_number') THEN
    ALTER TABLE subscriptions ADD COLUMN IF NOT EXISTS subscriber_number INTEGER;
  END IF;
END $$;

-- Backfill subscriber numbers
DO $$
DECLARE
  sub RECORD;
  counter INTEGER := 1000;
BEGIN
  FOR sub IN SELECT id FROM subscriptions WHERE subscriber_number IS NULL ORDER BY created_at LOOP
    UPDATE subscriptions SET subscriber_number = counter WHERE id = sub.id;
    counter := counter + 1;
  END LOOP;
END $$;

CREATE SEQUENCE IF NOT EXISTS subscriber_number_seq START WITH 1000 INCREMENT BY 1;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'subscriptions_subscriber_number_key') THEN
    ALTER TABLE subscriptions ADD CONSTRAINT subscriptions_subscriber_number_key UNIQUE (subscriber_number);
  END IF;
EXCEPTION WHEN OTHERS THEN
  RAISE NOTICE 'Could not add subscriber_number constraint: %', SQLERRM;
END $$;
