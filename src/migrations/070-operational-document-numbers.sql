-- Stable tenant-scoped numbers for operational transactions that previously
-- exposed UUIDs only. Human prefixes are presentation-level (CT/STK/BR); the
-- database stores the concurrency-safe numeric sequence.

ALTER TABLE cash_transactions ADD COLUMN IF NOT EXISTS number INTEGER;
ALTER TABLE inventory_transactions ADD COLUMN IF NOT EXISTS number INTEGER;
ALTER TABLE bank_reconciliation ADD COLUMN IF NOT EXISTS number INTEGER;

WITH ranked AS (
  SELECT id, row_number() OVER (PARTITION BY company_id ORDER BY created_at, id)::INTEGER AS seq
  FROM cash_transactions
) UPDATE cash_transactions target SET number=ranked.seq FROM ranked
  WHERE target.id=ranked.id AND target.number IS NULL;

WITH ranked AS (
  SELECT id, row_number() OVER (PARTITION BY company_id ORDER BY created_at, id)::INTEGER AS seq
  FROM inventory_transactions
) UPDATE inventory_transactions target SET number=ranked.seq FROM ranked
  WHERE target.id=ranked.id AND target.number IS NULL;

WITH ranked AS (
  SELECT id, row_number() OVER (PARTITION BY company_id ORDER BY created_at, id)::INTEGER AS seq
  FROM bank_reconciliation
) UPDATE bank_reconciliation target SET number=ranked.seq FROM ranked
  WHERE target.id=ranked.id AND target.number IS NULL;

CREATE UNIQUE INDEX IF NOT EXISTS uq_cash_transactions_company_number
  ON cash_transactions(company_id, number);
CREATE UNIQUE INDEX IF NOT EXISTS uq_inventory_transactions_company_number
  ON inventory_transactions(company_id, number);
CREATE UNIQUE INDEX IF NOT EXISTS uq_bank_reconciliation_company_number
  ON bank_reconciliation(company_id, number);

CREATE OR REPLACE FUNCTION public.assign_operational_document_number()
RETURNS TRIGGER LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
DECLARE v_next INTEGER;
BEGIN
  IF NEW.company_id IS NULL THEN RAISE EXCEPTION 'company_id is required for document numbering'; END IF;
  IF NEW.number IS NOT NULL THEN RETURN NEW; END IF;
  PERFORM pg_advisory_xact_lock(hashtextextended(
    'operational-number:' || TG_TABLE_NAME || ':' || NEW.company_id::TEXT, 0
  ));
  EXECUTE format('SELECT COALESCE(MAX(number),0)+1 FROM public.%I WHERE company_id=$1', TG_TABLE_NAME)
    INTO v_next USING NEW.company_id;
  NEW.number := v_next;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_cash_transaction_number ON cash_transactions;
CREATE TRIGGER trg_cash_transaction_number BEFORE INSERT ON cash_transactions
  FOR EACH ROW EXECUTE FUNCTION public.assign_operational_document_number();
DROP TRIGGER IF EXISTS trg_inventory_transaction_number ON inventory_transactions;
CREATE TRIGGER trg_inventory_transaction_number BEFORE INSERT ON inventory_transactions
  FOR EACH ROW EXECUTE FUNCTION public.assign_operational_document_number();
DROP TRIGGER IF EXISTS trg_bank_reconciliation_number ON bank_reconciliation;
CREATE TRIGGER trg_bank_reconciliation_number BEFORE INSERT ON bank_reconciliation
  FOR EACH ROW EXECUTE FUNCTION public.assign_operational_document_number();

ALTER TABLE cash_transactions ALTER COLUMN number SET NOT NULL;
ALTER TABLE inventory_transactions ALTER COLUMN number SET NOT NULL;
ALTER TABLE bank_reconciliation ALTER COLUMN number SET NOT NULL;

REVOKE ALL ON FUNCTION public.assign_operational_document_number() FROM PUBLIC,anon,authenticated;
