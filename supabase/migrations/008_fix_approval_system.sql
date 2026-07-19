-- ============================================================
-- Migration: Fix Approval System for Telegram
-- Date: 2026-07-19
-- Description: Fix the approval system to properly handle Telegram approvals
-- ============================================================

-- 1. Add status column to all transaction tables
ALTER TABLE voucher_disbursements 
ADD COLUMN IF NOT EXISTS status TEXT DEFAULT 'pending' 
CHECK(status IN ('pending', 'approved', 'rejected', 'cancelled'));

ALTER TABLE voucher_receipts 
ADD COLUMN IF NOT EXISTS status TEXT DEFAULT 'pending' 
CHECK(status IN ('pending', 'approved', 'rejected', 'cancelled'));

ALTER TABLE cash_transactions 
ADD COLUMN IF NOT EXISTS status TEXT DEFAULT 'pending' 
CHECK(status IN ('pending', 'approved', 'rejected', 'cancelled'));

ALTER TABLE journal_entries 
ADD COLUMN IF NOT EXISTS status TEXT DEFAULT 'pending' 
CHECK(status IN ('pending', 'posted', 'rejected', 'cancelled'));

-- 2. Add approval tracking columns
ALTER TABLE voucher_disbursements 
ADD COLUMN IF NOT EXISTS approval_request_id UUID REFERENCES approval_requests(id),
ADD COLUMN IF NOT EXISTS approved_by UUID REFERENCES users(id),
ADD COLUMN IF NOT EXISTS approved_at TIMESTAMPTZ;

ALTER TABLE voucher_receipts 
ADD COLUMN IF NOT EXISTS approval_request_id UUID REFERENCES approval_requests(id),
ADD COLUMN IF NOT EXISTS approved_by UUID REFERENCES users(id),
ADD COLUMN IF NOT EXISTS approved_at TIMESTAMPTZ;

ALTER TABLE cash_transactions 
ADD COLUMN IF NOT EXISTS approval_request_id UUID REFERENCES approval_requests(id),
ADD COLUMN IF NOT EXISTS approved_by UUID REFERENCES users(id),
ADD COLUMN IF NOT EXISTS approved_at TIMESTAMPTZ;

ALTER TABLE journal_entries 
ADD COLUMN IF NOT EXISTS approval_request_id UUID REFERENCES approval_requests(id),
ADD COLUMN IF NOT EXISTS approved_by UUID REFERENCES users(id),
ADD COLUMN IF NOT EXISTS approved_at TIMESTAMPTZ;

-- 3. Add indexes for performance
CREATE INDEX IF NOT EXISTS idx_approval_requests_status_created 
ON approval_requests(status, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_voucher_disbursements_status 
ON voucher_disbursements(status);

CREATE INDEX IF NOT EXISTS idx_voucher_receipts_status 
ON voucher_receipts(status);

CREATE INDEX IF NOT EXISTS idx_cash_transactions_status 
ON cash_transactions(status);

CREATE INDEX IF NOT EXISTS idx_journal_entries_status 
ON journal_entries(status);

-- 4. Create function to handle approval execution
CREATE OR REPLACE FUNCTION execute_approved_transaction(approval_id UUID)
RETURNS VOID AS $$
DECLARE
  v_company_id UUID;
  v_transaction_type TEXT;
  v_transaction_id TEXT;
  v_approver_chat_id TEXT;
  v_status TEXT;
BEGIN
  -- Get approval details
  SELECT company_id, transaction_type, transaction_id, approver_chat_id, status
  INTO v_company_id, v_transaction_type, v_transaction_id, v_approver_chat_id, v_status
  FROM approval_requests
  WHERE id = approval_id;

  -- Only process if approved
  IF v_status != 'approved' THEN
    RETURN;
  END IF;

  -- Update the corresponding transaction table
  CASE v_transaction_type
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

    WHEN 'journal_entry' THEN
      UPDATE journal_entries
      SET status = 'posted',
          approval_request_id = approval_id,
          approved_at = NOW()
      WHERE id = v_transaction_id::UUID AND company_id = v_company_id;

    WHEN 'purchase_invoice' THEN
      UPDATE purchase_invoices
      SET status = 'approved',
          approved_at = NOW()
      WHERE id = v_transaction_id::UUID AND company_id = v_company_id;

    WHEN 'payroll' THEN
      UPDATE salary_sheets
      SET status = 'approved',
          approved_at = NOW()
      WHERE id = v_transaction_id::UUID AND company_id = v_company_id;
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
      'approval_id', approval_id,
      'approver_chat_id', v_approver_chat_id
    ),
    NOW()
  );

END;
$$ LANGUAGE plpgsql;

-- 5. Create trigger for automatic approval execution
DROP TRIGGER IF EXISTS tr_execute_approved_transaction ON approval_requests;
CREATE TRIGGER tr_execute_approved_transaction
AFTER UPDATE ON approval_requests
FOR EACH ROW
WHEN (NEW.status = 'approved' AND OLD.status = 'pending')
EXECUTE FUNCTION execute_approved_transaction(NEW.id);

-- 6. Add comments for documentation
COMMENT ON COLUMN voucher_disbursements.status IS 'Transaction status: pending, approved, rejected, cancelled';
COMMENT ON COLUMN voucher_receipts.status IS 'Transaction status: pending, approved, rejected, cancelled';
COMMENT ON COLUMN cash_transactions.status IS 'Transaction status: pending, approved, rejected, cancelled';
COMMENT ON COLUMN journal_entries.status IS 'Transaction status: pending, posted, rejected, cancelled';

COMMENT ON FUNCTION execute_approved_transaction IS 'Automatically executes/approves transactions when approval status changes to approved';

-- 7. Fix existing pending transactions to be approved if they have been created before the system
UPDATE voucher_disbursements 
SET status = 'approved' 
WHERE status IS NULL OR status = '';

UPDATE voucher_receipts 
SET status = 'approved' 
WHERE status IS NULL OR status = '';

UPDATE cash_transactions 
SET status = 'approved' 
WHERE status IS NULL OR status = '';

UPDATE journal_entries 
SET status = 'posted' 
WHERE status IS NULL OR status = '';