-- Migration 012: Enhanced Custody System - Files, Transactions, Invoice Deduction, Payroll Link

-- 1. Enhance existing custodies table to act as files
ALTER TABLE custodies ADD COLUMN IF NOT EXISTS total_received NUMERIC(15,2) DEFAULT 0;
ALTER TABLE custodies ADD COLUMN IF NOT EXISTS total_expenses NUMERIC(15,2) DEFAULT 0;
ALTER TABLE custodies ADD COLUMN IF NOT EXISTS remaining_amount NUMERIC(15,2) DEFAULT 0;
ALTER TABLE custodies ADD COLUMN IF NOT EXISTS project_id UUID REFERENCES projects(id);
ALTER TABLE custodies ADD COLUMN IF NOT EXISTS file_number TEXT;
ALTER TABLE custodies ADD COLUMN IF NOT EXISTS notes TEXT;
ALTER TABLE custodies ADD COLUMN IF NOT EXISTS description TEXT;
ALTER TABLE custodies ADD COLUMN IF NOT EXISTS settlement_amount NUMERIC(15,2);
ALTER TABLE custodies ADD COLUMN IF NOT EXISTS settlement_date DATE;
ALTER TABLE custodies ADD COLUMN IF NOT EXISTS settlement_description TEXT;
ALTER TABLE custodies ADD COLUMN IF NOT EXISTS updated_at TIMESTAMPTZ DEFAULT NOW();
ALTER TABLE custodies ADD COLUMN IF NOT EXISTS deleted_at TIMESTAMPTZ;

-- Update existing records to have correct remaining
UPDATE custodies SET 
  total_received = amount,
  remaining_amount = amount,
  total_expenses = 0
WHERE total_received IS NULL OR total_received = 0;

-- 2. Custody Transactions - Detailed movements inside file
CREATE TABLE IF NOT EXISTS custody_transactions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id UUID NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
  custody_id UUID NOT NULL REFERENCES custodies(id) ON DELETE CASCADE,
  type TEXT NOT NULL CHECK (type IN ('receipt', 'addition', 'expense', 'return', 'shortage', 'surplus', 'adjustment')),
  amount NUMERIC(15,2) NOT NULL,
  description TEXT,
  reference_type TEXT, -- invoice, receipt, etc.
  reference_id UUID,
  created_by UUID REFERENCES users(id),
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_custody_transactions_custody ON custody_transactions(custody_id);
CREATE INDEX IF NOT EXISTS idx_custody_transactions_company ON custody_transactions(company_id);
CREATE INDEX IF NOT EXISTS idx_custody_transactions_type ON custody_transactions(type);

-- 3. Link invoices to custody to prevent duplication
CREATE TABLE IF NOT EXISTS custody_invoices (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id UUID NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
  custody_id UUID NOT NULL REFERENCES custodies(id) ON DELETE CASCADE,
  invoice_id UUID REFERENCES invoices(id) ON DELETE SET NULL,
  purchase_invoice_id UUID REFERENCES purchase_invoices(id) ON DELETE SET NULL,
  amount NUMERIC(15,2) NOT NULL,
  description TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE(custody_id, invoice_id),
  UNIQUE(custody_id, purchase_invoice_id)
);

CREATE INDEX IF NOT EXISTS idx_custody_invoices_custody ON custody_invoices(custody_id);

-- 4. Ensure employee_advances can be used for custody shortage deduction
ALTER TABLE employee_advances ADD COLUMN IF NOT EXISTS custody_id UUID REFERENCES custodies(id);
ALTER TABLE employee_advances ADD COLUMN IF NOT EXISTS type TEXT DEFAULT 'advance' CHECK (type IN ('advance', 'deduction', 'custody_shortage', 'custody_surplus'));

-- 5. Payroll deductions for custody shortage
-- Add column to payroll to track custody deductions
ALTER TABLE payroll ADD COLUMN IF NOT EXISTS custody_deduction NUMERIC(15,2) DEFAULT 0;

-- 6. Function to update custody remaining amount automatically
CREATE OR REPLACE FUNCTION update_custody_remaining()
RETURNS TRIGGER AS $$
BEGIN
  IF TG_OP = 'INSERT' THEN
    IF NEW.type IN ('receipt', 'addition', 'surplus') THEN
      UPDATE custodies SET 
        total_received = COALESCE(total_received, 0) + NEW.amount,
        remaining_amount = COALESCE(remaining_amount, 0) + NEW.amount,
        updated_at = NOW()
      WHERE id = NEW.custody_id;
    ELSIF NEW.type IN ('expense', 'return', 'shortage') THEN
      UPDATE custodies SET 
        total_expenses = COALESCE(total_expenses, 0) + NEW.amount,
        remaining_amount = COALESCE(remaining_amount, 0) - NEW.amount,
        updated_at = NOW()
      WHERE id = NEW.custody_id;
    END IF;
  ELSIF TG_OP = 'DELETE' THEN
    IF OLD.type IN ('receipt', 'addition', 'surplus') THEN
      UPDATE custodies SET 
        total_received = total_received - OLD.amount,
        remaining_amount = remaining_amount - OLD.amount
      WHERE id = OLD.custody_id;
    ELSIF OLD.type IN ('expense', 'return', 'shortage') THEN
      UPDATE custodies SET 
        total_expenses = total_expenses - OLD.amount,
        remaining_amount = remaining_amount + OLD.amount
      WHERE id = OLD.custody_id;
    END IF;
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_custody_transactions_update ON custody_transactions;
CREATE TRIGGER trg_custody_transactions_update
AFTER INSERT OR DELETE ON custody_transactions
FOR EACH ROW EXECUTE FUNCTION update_custody_remaining();

-- 7. View for custody file summary
CREATE OR REPLACE VIEW vw_custody_files AS
SELECT 
  c.id,
  c.company_id,
  c.employee_id,
  e.name as employee_name,
  c.project_id,
  p.name as project_name,
  c.amount as original_amount,
  c.total_received,
  c.total_expenses,
  c.remaining_amount,
  c.status,
  COALESCE(c.description, c.reason, c.notes) as description,
  c.file_number,
  c.created_at,
  COUNT(ct.id) as transaction_count,
  SUM(CASE WHEN ct.type = 'expense' THEN ct.amount ELSE 0 END) as expenses_from_transactions
FROM custodies c
LEFT JOIN employees e ON e.id = c.employee_id
LEFT JOIN projects p ON p.id = c.project_id
LEFT JOIN custody_transactions ct ON ct.custody_id = c.id
WHERE c.deleted_at IS NULL
GROUP BY c.id, e.name, p.name;

SELECT 'Migration 012 completed - Enhanced custody system with files, transactions, invoice linkage, payroll link' as result;
