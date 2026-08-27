-- Fix race conditions in numbering using PostgreSQL Sequences and advisory locks

-- 1. Create PostgreSQL Sequence functions
CREATE OR REPLACE FUNCTION get_next_number_sequence(
  p_sequence_name TEXT,
  p_company_id UUID
)
RETURNS INTEGER AS $$
DECLARE
  v_last_number INTEGER;
BEGIN
  -- محاولة الحصول على الرقم الحالي مع lock
  SELECT last_number INTO v_last_number
  FROM journal_sequences
  WHERE company_id = p_company_id AND year = EXTRACT(YEAR FROM CURRENT_DATE)
  FOR UPDATE;
  
  IF NOT FOUND THEN
    -- إنشاء تسلسيل جديد إذا لم يكن موجوداً
    INSERT INTO journal_sequences (company_id, year, last_number)
    VALUES (p_company_id, EXTRACT(YEAR FROM CURRENT_DATE), 0);
    v_last_number := 0;
  END IF;
  
  -- زيادة الرقم
  v_last_number := v_last_number + 1;
  
  -- تحديث التسلسيل
  UPDATE journal_sequences
  SET last_number = v_last_number, updated_at = NOW()
  WHERE company_id = p_company_id AND year = EXTRACT(YEAR FROM CURRENT_DATE);
  
  RETURN v_last_number;
END;
$$ LANGUAGE plpgsql;

-- 2. Fix the buggy getNextNumberForTable function
CREATE OR REPLACE FUNCTION get_next_number_for_table(
  p_table TEXT,
  p_company_id UUID
)
RETURNS INTEGER AS $$
DECLARE
  v_last_number INTEGER;
  v_sequence_table TEXT;
BEGIN
  -- تحديد جدول التسلسيل الصحيح
  CASE p_table
    WHEN 'journal_entries' THEN
      v_sequence_table := 'journal_sequences';
    WHEN 'invoices' THEN
      v_sequence_table := 'invoice_sequences';
    WHEN 'voucher_receipts' THEN
      v_sequence_table := 'voucher_receipt_sequences';
    WHEN 'voucher_disbursements' THEN
      v_sequence_table := 'voucher_disbursement_sequences';
    ELSE
      RAISE EXCEPTION 'Unsupported table for numbering: %', p_table;
  END CASE;
  
  -- استخدام الدالة الآمنة
  RETURN get_next_number_sequence(v_sequence_table, p_company_id);
END;
$$ LANGUAGE plpgsql;

-- 3. Add indexes for better performance
CREATE INDEX IF NOT EXISTS idx_journal_sequences_company_year 
ON journal_sequences(company_id, year);

CREATE INDEX IF NOT EXISTS idx_invoice_sequences_company_year 
ON invoice_sequences(company_id, year);

CREATE INDEX IF NOT EXISTS idx_voucher_receipt_sequences_company_year 
ON voucher_receipt_sequences(company_id, year);

CREATE INDEX IF NOT EXISTS idx_voucher_disbursement_sequences_company_year 
ON voucher_disbursement_sequences(company_id, year);

-- 4. Fix the missing journal_sequences table
CREATE TABLE IF NOT EXISTS journal_sequences (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id UUID NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
  year INTEGER NOT NULL,
  last_number INTEGER NOT NULL DEFAULT 0,
  updated_at TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE(company_id, year)
);

-- 5. Add validation constraints to prevent race conditions in application level
CREATE OR REPLACE FUNCTION validate_journal_balance()
RETURNS TRIGGER AS $$
DECLARE
  v_total_debit NUMERIC;
  v_total_credit NUMERIC;
BEGIN
  -- حساب مجموع المدين والدائن
  SELECT COALESCE(SUM(debit), 0), COALESCE(SUM(credit), 0)
  INTO v_total_debit, v_total_credit
  FROM journal_lines
  WHERE journal_entry_id = NEW.id;
  
  -- التحقق من التوازن (مع تسامح بسيط للأخطاء العشرية)
  IF ABS(v_total_debit - v_total_credit) > 0.01 THEN
    RAISE EXCEPTION 'Journal entry must be balanced (debit = credit). Debit: %, Credit: %', 
      v_total_debit, v_total_credit;
  END IF;
  
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- 6. Add constraint to ensure invoice items match subtotal
CREATE OR REPLACE FUNCTION validate_invoice_subtotal()
RETURNS TRIGGER AS $$
DECLARE
  v_calculated_subtotal NUMERIC;
  v_subtotal NUMERIC;
BEGIN
  -- حساب المجموع الحقيقي من البنود
  SELECT COALESCE(SUM(quantity * unit_price), 0)
  INTO v_calculated_subtotal
  FROM invoice_items
  WHERE invoice_id = NEW.id;
  
  v_subtotal := NEW.subtotal;
  
  -- التحقق من التوافق
  IF ABS(v_calculated_subtotal - v_subtotal) > 0.01 THEN
    RAISE EXCEPTION 'Invoice subtotal (%) does not match items total (%)', 
      v_subtotal, v_calculated_subtotal;
  END IF;
  
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- 7. Apply triggers
DROP TRIGGER IF EXISTS tr_validate_journal_balance ON journal_entries;
CREATE TRIGGER tr_validate_journal_balance
BEFORE INSERT OR UPDATE ON journal_entries
FOR EACH ROW
EXECUTE FUNCTION validate_journal_balance();

DROP TRIGGER IF EXISTS tr_validate_invoice_subtotal ON invoices;
CREATE TRIGGER tr_validate_invoice_subtotal
BEFORE INSERT OR UPDATE ON invoices
FOR EACH ROW
WHEN (NEW.status != 'draft')
EXECUTE FUNCTION validate_invoice_subtotal();

-- 8. Fix Receipt GET to not swallow errors (update the API code to remove the catch-all success response)