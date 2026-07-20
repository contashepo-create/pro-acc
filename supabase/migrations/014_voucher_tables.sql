-- ============================================================
-- Migration: Create Voucher Tables (سندات القبض والصرف)
-- Date: 2026-07-20
-- Description: Create tables for voucher receipts and disbursements with all dependencies
-- ============================================================

-- 1. Banks and Safes (البنوك والخزينة)
CREATE TABLE IF NOT EXISTS banks_safes (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id UUID NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  account_id UUID REFERENCES accounts(id) ON DELETE SET NULL,
  type TEXT NOT NULL CHECK(type IN ('bank', 'safe') DEFAULT 'bank'),
  balance NUMERIC DEFAULT 0,
  is_default BOOLEAN DEFAULT false,
  is_active BOOLEAN DEFAULT true,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- Indexes for banks_safes
CREATE INDEX IF NOT EXISTS idx_banks_safes_company ON banks_safes(company_id);
CREATE INDEX IF NOT EXISTS idx_banks_safes_type ON banks_safes(type);
CREATE INDEX IF NOT EXISTS idx_banks_safes_is_default ON banks_safes(is_default, company_id);
CREATE INDEX IF NOT EXISTS idx_banks_safes_account_id ON banks_safes(account_id);

-- 2. Voucher Receipts (سندات القبض)
CREATE TABLE IF NOT EXISTS voucher_receipts (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id UUID NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
  number TEXT NOT NULL,
  date DATE NOT NULL,
  receipt_type TEXT NOT NULL CHECK(receipt_type IN ('client', 'supplier_refund', 'general')),
  contact_id UUID REFERENCES contacts(id) ON DELETE SET NULL,
  amount NUMERIC NOT NULL CHECK(amount > 0),
  bank_safe_id UUID NOT NULL REFERENCES banks_safes(id) ON DELETE CASCADE,
  reason TEXT NOT NULL,
  status TEXT DEFAULT 'approved' CHECK(status IN ('draft', 'approved', 'paid')),
  journal_entry_id UUID REFERENCES journal_entries(id) ON DELETE SET NULL,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  created_by UUID REFERENCES users(id)
);

-- Indexes for voucher_receipts
CREATE INDEX IF NOT EXISTS idx_voucher_receipts_company ON voucher_receipts(company_id);
CREATE INDEX IF NOT EXISTS idx_voucher_receipts_date ON voucher_receipts(date DESC);
CREATE INDEX IF NOT EXISTS idx_voucher_receipts_type ON voucher_receipts(receipt_type);
CREATE INDEX IF NOT EXISTS idx_voucher_receipts_status ON voucher_receipts(status);
CREATE INDEX IF NOT EXISTS idx_voucher_receipts_number ON voucher_receipts(number);
CREATE INDEX IF NOT EXISTS idx_voucher_receipts_contact ON voucher_receipts(contact_id);

-- 3. Voucher Disbursements (سندات الصرف)
CREATE TABLE IF NOT EXISTS voucher_disbursements (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id UUID NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
  number TEXT NOT NULL,
  date DATE NOT NULL,
  disbursement_type TEXT NOT NULL CHECK(disbursement_type IN ('general', 'supplier', 'employee_advance', 'subcontractor')),
  contact_id UUID REFERENCES contacts(id) ON DELETE SET NULL,
  employee_id UUID REFERENCES employees(id) ON DELETE SET NULL,
  amount NUMERIC NOT NULL CHECK(amount > 0),
  bank_safe_id UUID NOT NULL REFERENCES banks_safes(id) ON DELETE CASCADE,
  reason TEXT NOT NULL,
  status TEXT DEFAULT 'approved' CHECK(status IN ('draft', 'approved', 'paid', 'rejected')),
  journal_entry_id UUID REFERENCES journal_entries(id) ON DELETE SET NULL,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  created_by UUID REFERENCES users(id)
);

-- Indexes for voucher_disbursements
CREATE INDEX IF NOT EXISTS idx_voucher_disbursements_company ON voucher_disbursements(company_id);
CREATE INDEX IF NOT EXISTS idx_voucher_disbursements_date ON voucher_disbursements(date DESC);
CREATE INDEX IF NOT EXISTS idx_voucher_disbursements_type ON voucher_disbursements(disbursement_type);
CREATE INDEX IF NOT EXISTS idx_voucher_disbursements_status ON voucher_disbursements(status);
CREATE INDEX IF NOT EXISTS idx_voucher_disbursements_number ON voucher_disbursements(number);
CREATE INDEX IF NOT EXISTS idx_voucher_disbursements_contact ON voucher_disbursements(contact_id);
CREATE INDEX IF NOT EXISTS idx_voucher_disbursements_employee ON voucher_disbursements(employee_id);

-- 4. Voucher Sequences for auto-numbering
CREATE TABLE IF NOT EXISTS voucher_receipt_sequences (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id UUID NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
  year INTEGER NOT NULL,
  last_number INTEGER DEFAULT 0,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  UNIQUE(company_id, year)
);

CREATE INDEX IF NOT EXISTS idx_voucher_receipt_sequences_company_year ON voucher_receipt_sequences(company_id, year);

CREATE TABLE IF NOT EXISTS voucher_disbursement_sequences (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id UUID NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
  year INTEGER NOT NULL,
  last_number INTEGER DEFAULT 0,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  UNIQUE(company_id, year)
);

CREATE INDEX IF NOT EXISTS idx_voucher_disbursement_sequences_company_year ON voucher_disbursement_sequences(company_id, year);

-- 5. Additional voucher-related tables

-- Employee Advances (سلف الموظفين)
CREATE TABLE IF NOT EXISTS employee_advances (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id UUID NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
  employee_id UUID REFERENCES employees(id) ON DELETE CASCADE,
  amount NUMERIC NOT NULL DEFAULT 0,
  date DATE NOT NULL,
  reason TEXT,
  status TEXT DEFAULT 'pending' CHECK(status IN ('pending', 'approved', 'rejected', 'paid')),
  repaid_amount NUMERIC DEFAULT 0,
  due_date DATE,
  notes TEXT,
  journal_entry_id UUID REFERENCES journal_entries(id) ON DELETE SET NULL,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  created_by UUID REFERENCES users(id)
);

CREATE INDEX IF NOT EXISTS idx_employee_advances_employee ON employee_advances(employee_id);
CREATE INDEX IF NOT EXISTS idx_employee_advances_company ON employee_advances(company_id);
CREATE INDEX IF NOT EXISTS idx_employee_advances_date ON employee_advances(date);

-- Client Advances (سلفة العملاء)
CREATE TABLE IF NOT EXISTS client_advances (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id UUID NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
  client_id UUID REFERENCES contacts(id) ON DELETE CASCADE,
  amount NUMERIC NOT NULL DEFAULT 0,
  date DATE NOT NULL,
  reason TEXT,
  status TEXT DEFAULT 'pending' CHECK(status IN ('pending', 'approved', 'rejected', 'paid')),
  repaid_amount NUMERIC DEFAULT 0,
  due_date DATE,
  notes TEXT,
  journal_entry_id UUID REFERENCES journal_entries(id) ON DELETE SET NULL,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  created_by UUID REFERENCES users(id)
);

CREATE INDEX IF NOT EXISTS idx_client_advances_client ON client_advances(client_id);
CREATE INDEX IF NOT EXISTS idx_client_advances_company ON client_advances(company_id);
CREATE INDEX IF NOT EXISTS idx_client_advances_date ON client_advances(date);

-- 6. Contact Balance check table (متابقة رصيد العملاء والموردين)
CREATE TABLE IF NOT EXISTS contact_balances (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id UUID NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
  contact_id UUID NOT NULL REFERENCES contacts(id) ON DELETE CASCADE,
  balance NUMERIC DEFAULT 0,
  last_checked TIMESTAMP WITH TIME ZONE,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  UNIQUE(company_id, contact_id)
);

CREATE INDEX IF NOT EXISTS idx_contact_balances_company ON contact_balances(company_id);

-- 7. RPC Functions for auto-numbering vouchers
CREATE OR REPLACE FUNCTION next_voucher_number(
  p_company_id UUID,
  p_table_name TEXT
) RETURNS NUMERIC AS $$
DECLARE
  v_year INTEGER;
  v_table TEXT;
  v_sequence_table TEXT;
  v_next_num INTEGER;
BEGIN
  v_year := EXTRACT(YEAR FROM CURRENT_DATE);
  v_table := CASE
    WHEN p_table_name = 'voucher_receipts' THEN 'voucher_receipt_sequences'
    WHEN p_table_name = 'voucher_disbursements' THEN 'voucher_disbursement_sequences'
    ELSE 'voucher_disbursement_sequences'
  END;
  v_sequence_table := v_table;
  
  BEGIN
    -- Try to get existing sequence
    SELECT last_number INTO v_next_num
    FROM v_sequence_table
    WHERE company_id = p_company_id AND year = v_year
    FOR UPDATE;

    IF v_next_num IS NULL THEN
      -- No sequence exists, create it
      INSERT INTO v_sequence_table (company_id, year, last_number)
      VALUES (p_company_id, v_year, 0);
      v_next_num := 0;
    END IF;
    
    -- Increment and update
    UPDATE v_sequence_table
    SET last_number = v_next_num + 1
    WHERE company_id = p_company_id AND year = v_year;
    
    RETURN v_next_num + 1;
  END;
END;
$$ LANGUAGE plpgsql;

-- 8. Triggers for voucher status updates
CREATE OR REPLACE FUNCTION update_voucher_status()
RETURNS TRIGGER AS $$
BEGIN
  IF NEW.status = OLD.status THEN
    RETURN NEW;
  END;
  
  UPDATE voucher_receipts
    SET updated_at = NOW()
    WHERE id = NEW.id;
  
  UPDATE voucher_disbursements
    SET updated_at = NOW()
    WHERE id = NEW.id;
  
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- Apply the trigger to voucher tables
DROP TRIGGER IF EXISTS update_voucher_status ON voucher_receipts;
DROP TRIGGER IF EXISTS update_voucher_status ON voucher_disbursements;

CREATE TRIGGER update_voucher_status ON voucher_receipts
  AFTER UPDATE OF status
  FOR EACH ROW
  EXECUTE FUNCTION update_voucher_status();

CREATE TRIGGER update_voucher_status ON voucher_disbursements
  AFTER UPDATE OF status
  FOR EACH ROW
  EXECUTE FUNCTION update_voucher_status();

-- Comments
COMMENT ON TABLE banks_safes IS 'جدول البنوك والخزينة للسندات';
COMMENT ON TABLE voucher_receipts IS 'جدول سندات القبض (سندات القبض)';
COMMENT ON TABLE voucher_disbursements IS 'جدول سندات الصرف (سندات الصرف)';
COMMENT ON TABLE employee_advances IS 'جدول سلف الموظفين';
COMMENT ON TABLE client_advances IS 'جدول سلفة العملاء';
COMMENT ON TABLE contact_balances IS 'جدول متابقات رصيد العملاء والموردين';
COMMENT ON TABLE voucher_receipt_sequences IS 'جدول أرقام سندات القبض';
COMMENT ON TABLE voucher_disbursement_sequences IS 'جدول أرقام سندات الصرف';
COMMENT ON FUNCTION next_voucher_number IS 'دالة للحصول على الرقم التالي للسند';
COMMENT ON FUNCTION update_voucher_status IS 'دالة لتحديث وقت التحديث عند تغيير حالة السند';

-- Constraints and permissions
ALTER TABLE voucher_receipts ADD CONSTRAINT IF NOT EXISTS voucher_receipts_amount_positive CHECK (amount > 0);
ALTER TABLE voucher_disbursements ADD CONSTRAINT IF NOT EXISTS voucher_disbursements_amount_positive CHECK (amount > 0);

-- Add permissions for voucher management
INSERT INTO custom_modules (name, description, category) VALUES
('vouchers', 'إدارة السندات', 'accounting');

INSERT INTO custom_actions (name, description, category, module, required_permission) VALUES
('vouchers_receipt_create', 'إنشاء سند قبض جديد', 'accounting', 'vouchers', 'create'),
('vouchers_receipt_view', 'عرض سندات القبض', 'accounting', 'vouchers', 'read'),
('vouchers_disbursement_create', 'إنشاء سند صرف جديد', 'accounting', 'vouchers', 'create'),
('vouchers_disbursement_view', 'عرض سندات الصرف', 'accounting', 'vouchers', 'read'),
('vouchers_edit', 'تعديل السندات', 'accounting', 'vouchers', 'edit'),
('vouchers_delete', 'حذف السندات', 'accounting', 'vouchers', 'delete');