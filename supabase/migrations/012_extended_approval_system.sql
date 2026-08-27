-- ============================================================
-- Migration: Extended Approval System for More Transaction Types
-- Date: 2026-07-19
-- Description: Add support for fixed assets, inventory, payroll, and project expense approvals
-- ============================================================

-- 1. Add new transaction types to approval_requests table constraint
ALTER TABLE approval_requests 
DROP CONSTRAINT IF EXISTS approval_requests_transaction_type_check;

ALTER TABLE approval_requests 
ADD CONSTRAINT approval_requests_transaction_type_check 
CHECK (transaction_type IN (
  'journal_entry',
  'voucher_disbursement',
  'voucher_receipt',
  'cash_transaction',
  'purchase_invoice',
  'payroll',
  'fixed_assets',
  'inventory_transaction',
  'project_expense',
  'employee_advance',
  'subcontractor_payment',
  'client_payment',
  'payment_disbursement'
));

-- 2. Add status columns to transaction tables that don't have them
ALTER TABLE fixed_assets 
ADD COLUMN IF NOT EXISTS approval_request_id UUID REFERENCES approval_requests(id),
ADD COLUMN IF NOT EXISTS status TEXT DEFAULT 'pending' 
CHECK(status IN ('pending', 'approved', 'rejected', 'cancelled', 'acquired'));

ALTER TABLE inventory_transactions 
ADD COLUMN IF NOT EXISTS approval_request_id UUID REFERENCES approval_requests(id),
ADD COLUMN IF NOT EXISTS status TEXT DEFAULT 'pending' 
CHECK(status IN ('pending', 'approved', 'rejected', 'cancelled'));

ALTER TABLE salary_sheets 
ADD COLUMN IF NOT EXISTS approval_request_id UUID REFERENCES approval_requests(id),
ADD COLUMN IF NOT EXISTS status TEXT DEFAULT 'pending' 
CHECK(status IN ('pending', 'approved', 'rejected', 'cancelled'));

ALTER TABLE project_expenses 
ADD COLUMN IF NOT EXISTS approval_request_id UUID REFERENCES approval_requests(id),
ADD COLUMN IF NOT EXISTS status TEXT DEFAULT 'pending' 
CHECK(status IN ('pending', 'approved', 'rejected', 'cancelled'));

-- 3. Add transaction_type mapping table for display names
CREATE TABLE IF NOT EXISTS transaction_type_names (
  code TEXT PRIMARY KEY,
  arabic_name TEXT NOT NULL,
  english_name TEXT NOT NULL,
  category TEXT NOT NULL,
  default_threshold NUMERIC DEFAULT 5000.00,
  requires_journal_entry BOOLEAN DEFAULT true,
  icon TEXT,
  color TEXT
);

INSERT INTO transaction_type_names (code, arabic_name, english_name, category, default_threshold, requires_journal_entry, icon, color) VALUES
-- Existing types
('journal_entry', 'قيد يومية', 'Journal Entry', 'accounting', 0, false, 'scale-3', 'blue'),
('voucher_disbursement', 'سند صرف', 'Voucher Disbursement', 'cash', 5000, true, 'arrow-up', 'red'),
('voucher_receipt', 'سند قبض', 'Voucher Receipt', 'cash', 3000, true, 'arrow-down', 'green'),
('cash_transaction', 'معاملة نقدية', 'Cash Transaction', 'cash', 2000, true, 'banknote', 'purple'),
('purchase_invoice', 'فاتورة شراء', 'Purchase Invoice', 'purchasing', 10000, true, 'shopping-cart', 'orange'),
('payroll', 'رواتب', 'Payroll', 'payroll', 50000, true, 'users', 'pink'),
-- New types
('fixed_assets', 'أصل ثابت', 'Fixed Asset', 'assets', 100000, true, 'landmark', 'teal'),
('inventory_transaction', 'حركة مخزون', 'Inventory Transaction', 'inventory', 5000, true, 'package', 'cyan'),
('project_expense', 'صرف مشروع', 'Project Expense', 'projects', 10000, true, 'briefcase', 'indigo'),
('employee_advance', 'سلفة موظف', 'Employee Advance', 'payroll', 3000, true, 'user-plus', 'amber'),
('subcontractor_payment', 'دفع مقاول', 'Subcontractor Payment', 'projects', 15000, true, 'hard-hat', 'brown'),
('client_payment', 'قبض عميل', 'Client Payment', 'cash', 3000, true, 'user-check', 'emerald'),
('payment_disbursement', 'دفع دائن', 'Payment Disbursement', 'cash', 5000, true, 'credit-card', 'rose')
ON CONFLICT (code) DO UPDATE SET 
  arabic_name = EXCLUDED.arabic_name,
  english_name = EXCLUDED.english_name,
  category = EXCLUDED.category,
  default_threshold = EXCLUDED.default_threshold,
  requires_journal_entry = EXCLUDED.requires_journal_entry,
  icon = EXCLUDED.icon,
  color = EXCLUDED.color;

-- 4. Add indexes for new transaction types
CREATE INDEX IF NOT EXISTS idx_approval_requests_fixed_assets 
ON approval_requests(transaction_type, entity_id)
WHERE transaction_type = 'fixed_assets';

CREATE INDEX IF NOT EXISTS idx_approval_requests_inventory 
ON approval_requests(transaction_type, entity_id)
WHERE transaction_type = 'inventory_transaction';

CREATE INDEX IF NOT EXISTS idx_approval_requests_payroll 
ON approval_requests(transaction_type, entity_id)
WHERE transaction_type = 'payroll';

CREATE INDEX IF NOT EXISTS idx_approval_requests_project_expenses 
ON approval_requests(transaction_type, entity_id)
WHERE transaction_type = 'project_expense';

CREATE INDEX IF NOT EXISTS idx_approval_requests_employee_advances 
ON approval_requests(transaction_type, entity_id)
WHERE transaction_type = 'employee_advance';

-- 5. Update approval execution function to handle new types
CREATE OR REPLACE FUNCTION execute_approved_transaction_extended(approval_id UUID)
RETURNS VOID AS $$
DECLARE
  v_company_id UUID;
  v_transaction_type TEXT;
  v_transaction_id TEXT;
  v_status TEXT;
BEGIN
  -- Get approval details
  SELECT company_id, transaction_type, transaction_id, status
  INTO v_company_id, v_transaction_type, v_transaction_id, v_status
  FROM approval_requests
  WHERE id = approval_id;

  -- Only process if approved
  IF v_status != 'approved' THEN
    RETURN;
  END IF;

  -- Update the corresponding transaction table
  CASE v_transaction_type
    WHEN 'journal_entry' THEN
      UPDATE journal_entries
      SET status = 'posted', 
          approval_request_id = approval_id,
          approved_at = NOW()
      WHERE id = v_transaction_id::UUID AND company_id = v_company_id;

    WHEN 'voucher_disbursement' THEN
      UPDATE voucher_disbursements
      SET status = 'approved', 
          approval_request_id = approval_id,
          approved_at = NOW()
      WHERE id = v_transaction_id::UUID AND company_id = v_company_id;

    WHEN 'voucher_receipt' THEN
      UPDATE voucher_receipts
      SET status = 'approved', 
          approval_request_id = approval_id,
          approved_at = NOW()
      WHERE id = v_transaction_id::UUID AND company_id = v_company_id;

    WHEN 'cash_transaction' THEN
      UPDATE cash_transactions
      SET status = 'approved', 
          approval_request_id = approval_id,
          approved_at = NOW()
      WHERE id = v_transaction_id::UUID AND company_id = v_company_id;

    WHEN 'purchase_invoice' THEN
      UPDATE purchase_invoices
      SET status = 'approved', 
          approval_request_id = approval_id,
          approved_at = NOW()
      WHERE id = v_transaction_id::UUID AND company_id = v_company_id;

    WHEN 'payroll' THEN
      UPDATE salary_sheets
      SET status = 'approved', 
          approval_request_id = approval_id,
          approved_at = NOW()
      WHERE id = v_transaction_id::UUID AND company_id = v_company_id;

    WHEN 'fixed_assets' THEN
      UPDATE fixed_assets
      SET status = 'approved', 
          approval_request_id = approval_id,
          approved_at = NOW()
      WHERE id = v_transaction_id::UUID AND company_id = v_company_id;

    WHEN 'inventory_transaction' THEN
      UPDATE inventory_transactions
      SET status = 'approved', 
          approval_request_id = approval_id,
          approved_at = NOW()
      WHERE id = v_transaction_id::UUID AND company_id = v_company_id;

    WHEN 'project_expense' THEN
      UPDATE project_expenses
      SET status = 'approved', 
          approval_request_id = approval_id,
          approved_at = NOW()
      WHERE id = v_transaction_id::UUID AND company_id = v_company_id;

    WHEN 'employee_advance' THEN
      UPDATE employee_advances
      SET status = 'approved', 
          approval_request_id = approval_id,
          approved_at = NOW()
      WHERE id = v_transaction_id::UUID AND company_id = v_company_id;

    WHEN 'subcontractor_payment' THEN
      UPDATE subcontractor_payments
      SET status = 'approved', 
          approved_request_id = approval_id,
          approved_at = NOW()
      WHERE id = v_transaction_id::UUID AND company_id = v_company_id;

    WHEN 'client_payment' THEN
      UPDATE invoice_payments
      SET status = 'approved', 
          approval_request_id = approval_id,
          approved_at = NOW()
      WHERE id = v_transaction_id::UUID AND company_id = v_company_id;

    WHEN 'payment_disbursement' THEN
      UPDATE payment_disbursements
      SET status = 'approved', 
          approval_request_id = approval_id,
          approved_at = NOW()
      WHERE id = v_transaction_id::UUID AND company_id = v_company_id;
      
    ELSE
      RAISE EXCEPTION 'Unknown transaction type: %', v_transaction_type;
  END CASE;

  -- Create audit log entry
  INSERT INTO audit_log (company_id, action, entity_type, entity_id, new_values, created_at)
  VALUES (
    v_company_id,
    'transaction_approved',
    v_transaction_type,
    v_transaction_id,
    jsonb_build_object(
      'status', 'approved',
      'approval_id', approval_id
    ),
    NOW()
  );

END;
$$ LANGUAGE plpgsql;

-- 6. Update trigger to use the extended function
DROP TRIGGER IF EXISTS tr_execute_approved_transaction ON approval_requests;
CREATE TRIGGER tr_execute_approved_transaction_extended
AFTER UPDATE ON approval_requests
FOR EACH ROW
WHEN (NEW.status = 'approved' AND OLD.status = 'pending')
EXECUTE FUNCTION execute_approved_transaction_extended(NEW.id);

-- 7. Add function to get transaction type display names
CREATE OR REPLACE FUNCTION get_transaction_type_name(type_code TEXT)
RETURNS TABLE (arabic_name TEXT, english_name TEXT, category TEXT, icon TEXT, color TEXT) AS $$
BEGIN
  RETURN QUERY 
    SELECT arabic_name, english_name, category, icon, color
    FROM transaction_type_names
    WHERE code = type_code;
END;
$$ LANGUAGE plpgsql;

--  comments
COMMENT ON TABLE transaction_type_names IS 'Display names and configuration for different transaction types';
COMMENT ON FUNCTION execute_approved_transaction_extended IS 'Execute approved transactions for all supported types including new ones';
COMMENT ON FUNCTION get_transaction_type_name IS 'Get display names for transaction types';