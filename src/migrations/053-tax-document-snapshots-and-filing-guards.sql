-- ============================================================
-- 053 - Immutable tax-document parties and VAT filing guards
-- ============================================================

BEGIN;

-- Historical schemas stored percentages as 15 while current writers use 0.15.
-- Normalize both legacy aliases and keep them synchronized for old readers.
WITH normalized AS (
  SELECT id,
    CASE
      WHEN COALESCE(vat_amount,0)=0 AND COALESCE(tax_amount,0)<>0 THEN tax_amount
      ELSE COALESCE(vat_amount,tax_amount,0)
    END AS amount,
    CASE
      WHEN COALESCE(vat_rate,tax_rate,0)>1 AND COALESCE(vat_rate,tax_rate,0)<=100
        THEN COALESCE(vat_rate,tax_rate,0)/100
      ELSE COALESCE(vat_rate,tax_rate,0)
    END AS rate
  FROM invoices
), canonical AS (
  SELECT i.id,n.amount,
    CASE WHEN n.amount=0 AND abs(COALESCE(i.total,0)-COALESCE(i.subtotal,0))<=0.01
      THEN 0 ELSE n.rate END AS rate
  FROM invoices i JOIN normalized n ON n.id=i.id
)
UPDATE invoices i
SET vat_rate=n.rate,tax_rate=n.rate,vat_amount=n.amount,tax_amount=n.amount
FROM canonical n WHERE n.id=i.id;

ALTER TABLE invoices ALTER COLUMN vat_rate SET DEFAULT 0.15;
ALTER TABLE invoices ALTER COLUMN tax_rate SET DEFAULT 0.15;
ALTER TABLE invoices ALTER COLUMN vat_amount SET DEFAULT 0;
ALTER TABLE invoices ALTER COLUMN tax_amount SET DEFAULT 0;
ALTER TABLE invoices ADD COLUMN IF NOT EXISTS tax_snapshot JSONB;

-- Freeze the seller and buyer identity used by future QR/XML generation. A tax
-- document must not change when either master record is edited months later.
UPDATE invoices i
SET tax_snapshot = jsonb_build_object(
  'seller', jsonb_build_object(
    'name', c.name,
    'vat_number', NULLIF(c.tax_number,''),
    'commercial_registration', c.commercial_registration,
    'address', c.address,
    'country_code', COALESCE(NULLIF(c.country_code,''),'SA'),
    'currency_code', COALESCE(NULLIF(c.currency_code,''),'SAR')
  ),
  'buyer', jsonb_build_object(
    'name', ct.name,
    'vat_number', ct.tax_number,
    'commercial_registration', ct.commercial_registration,
    'address', ct.address,
    'country_code', COALESCE(NULLIF(ct.country,''),NULLIF(c.country_code,''),'SA')
  ),
  'captured_at', COALESCE(i.created_at,now())
)
FROM companies c, contacts ct
WHERE i.company_id=c.id AND i.contact_id=ct.id AND ct.company_id=i.company_id
  AND i.tax_snapshot IS NULL;

CREATE OR REPLACE FUNCTION public.guard_invoice_tax_document()
RETURNS TRIGGER LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
DECLARE v_company companies%ROWTYPE; v_contact contacts%ROWTYPE; v_rate NUMERIC; v_tax NUMERIC;
BEGIN
  IF TG_OP='INSERT' THEN
    SELECT * INTO v_company FROM companies WHERE id=NEW.company_id;
    SELECT * INTO v_contact FROM contacts WHERE id=NEW.contact_id AND company_id=NEW.company_id;
    IF v_company.id IS NULL OR v_contact.id IS NULL THEN RAISE EXCEPTION 'invalid invoice tenant parties'; END IF;
    v_rate:=COALESCE(NEW.vat_rate,NEW.tax_rate,0);
    IF v_rate>1 AND v_rate<=100 THEN v_rate:=v_rate/100; END IF;
    v_tax:=CASE WHEN COALESCE(NEW.vat_amount,0)=0 AND COALESCE(NEW.tax_amount,0)<>0
      THEN NEW.tax_amount ELSE COALESCE(NEW.vat_amount,NEW.tax_amount,0) END;
    IF v_tax=0 AND abs(COALESCE(NEW.total,0)-COALESCE(NEW.subtotal,0))<=0.01 THEN v_rate:=0; END IF;
    IF v_rate<0 OR v_rate>1 OR v_tax<0 THEN RAISE EXCEPTION 'invalid invoice tax values'; END IF;
    NEW.vat_rate:=v_rate; NEW.tax_rate:=v_rate;
    NEW.vat_amount:=v_tax; NEW.tax_amount:=v_tax;
    IF NEW.tax_snapshot IS NULL THEN
      NEW.tax_snapshot:=jsonb_build_object(
        'seller',jsonb_build_object(
          'name',v_company.name,
          'vat_number',NULLIF(v_company.tax_number,''),
          'commercial_registration',v_company.commercial_registration,
          'address',v_company.address,
          'country_code',COALESCE(NULLIF(v_company.country_code,''),'SA'),
          'currency_code',COALESCE(NULLIF(v_company.currency_code,''),'SAR')
        ),
        'buyer',jsonb_build_object(
          'name',v_contact.name,
          'vat_number',v_contact.tax_number,
          'commercial_registration',v_contact.commercial_registration,
          'address',v_contact.address,
          'country_code',COALESCE(NULLIF(v_contact.country,''),NULLIF(v_company.country_code,''),'SA')
        ),
        'captured_at',now()
      );
    END IF;
    IF jsonb_typeof(NEW.tax_snapshot)<>'object' THEN RAISE EXCEPTION 'invalid invoice tax snapshot'; END IF;
    RETURN NEW;
  END IF;

  IF NEW.company_id IS DISTINCT FROM OLD.company_id
    OR NEW.number IS DISTINCT FROM OLD.number OR NEW.date IS DISTINCT FROM OLD.date
    OR NEW.contact_id IS DISTINCT FROM OLD.contact_id OR NEW.project_id IS DISTINCT FROM OLD.project_id
    OR NEW.subtotal IS DISTINCT FROM OLD.subtotal OR NEW.vat_rate IS DISTINCT FROM OLD.vat_rate
    OR NEW.tax_rate IS DISTINCT FROM OLD.tax_rate OR NEW.vat_amount IS DISTINCT FROM OLD.vat_amount
    OR NEW.tax_amount IS DISTINCT FROM OLD.tax_amount OR NEW.total IS DISTINCT FROM OLD.total
    OR NEW.tax_snapshot IS DISTINCT FROM OLD.tax_snapshot
  THEN RAISE EXCEPTION 'posted invoice tax document is immutable'; END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_guard_invoice_tax_document ON invoices;
CREATE TRIGGER trg_guard_invoice_tax_document
BEFORE INSERT OR UPDATE ON invoices
FOR EACH ROW EXECUTE FUNCTION guard_invoice_tax_document();

-- Existing rows should all have valid parties due to the foreign keys. Refuse
-- future null snapshots after the explicit backfill above.
ALTER TABLE invoices ALTER COLUMN tax_snapshot SET NOT NULL;
ALTER TABLE invoices DROP CONSTRAINT IF EXISTS invoices_vat_rate_fraction_check;
ALTER TABLE invoices ADD CONSTRAINT invoices_vat_rate_fraction_check
  CHECK(vat_rate BETWEEN 0 AND 1 AND tax_rate=vat_rate);
ALTER TABLE invoices DROP CONSTRAINT IF EXISTS invoices_vat_amount_consistency_check;
ALTER TABLE invoices ADD CONSTRAINT invoices_vat_amount_consistency_check
  CHECK(vat_amount>=0 AND tax_amount=vat_amount AND subtotal>=0 AND total>=0
    AND abs(total-round(subtotal+vat_amount,2))<=0.01);

-- Posted lines are source tax-document facts. Creation inserts lines before the
-- parent receives its journal id; after posting, no application write may edit
-- or append them behind the audited invoice lifecycle. Tenant reset remains the
-- sole whole-dataset deletion path and therefore retains DELETE capability.
CREATE OR REPLACE FUNCTION public.guard_posted_invoice_line()
RETURNS TRIGGER LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
DECLARE v_invoice_id UUID; v_company_id UUID;
BEGIN
  v_invoice_id:=CASE WHEN TG_OP='DELETE' THEN OLD.invoice_id ELSE NEW.invoice_id END;
  v_company_id:=CASE WHEN TG_OP='DELETE' THEN OLD.company_id ELSE NEW.company_id END;
  IF EXISTS(
    SELECT 1 FROM invoices WHERE id=v_invoice_id AND company_id=v_company_id
      AND (journal_entry_id IS NOT NULL OR created_at<transaction_timestamp())
  ) THEN RAISE EXCEPTION 'posted invoice lines are immutable'; END IF;
  RETURN CASE WHEN TG_OP='DELETE' THEN OLD ELSE NEW END;
END;
$$;
DROP TRIGGER IF EXISTS trg_guard_posted_invoice_line ON invoice_items;
CREATE TRIGGER trg_guard_posted_invoice_line
BEFORE INSERT OR UPDATE ON invoice_items
FOR EACH ROW EXECUTE FUNCTION guard_posted_invoice_line();

-- Rebuild the filing function with serialization and overlap rules. Exact
-- uniqueness alone does not stop two concurrent, overlapping filed periods.
CREATE OR REPLACE FUNCTION public.create_vat_return_filing_atomic(
  p_company_id UUID,p_period_from DATE,p_period_to DATE,p_status TEXT,p_notes TEXT,p_user_id UUID
) RETURNS JSONB
LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
DECLARE v_filing vat_return_filings%ROWTYPE;
BEGIN
  IF p_period_from IS NULL OR p_period_to IS NULL OR p_period_from>p_period_to
    OR p_period_to>CURRENT_DATE OR p_period_to-p_period_from>365
    OR p_status NOT IN('draft','filed') OR length(COALESCE(p_notes,''))>2000
  THEN RAISE EXCEPTION 'بيانات الإقرار الضريبي غير صالحة'; END IF;
  IF NOT EXISTS(SELECT 1 FROM users WHERE id=p_user_id AND company_id=p_company_id AND is_active=TRUE)
  THEN RAISE EXCEPTION 'المستخدم غير صالح'; END IF;

  PERFORM pg_advisory_xact_lock(hashtextextended('vat-filing:'||p_company_id::TEXT,0));
  IF EXISTS(
    SELECT 1 FROM vat_return_filings
    WHERE company_id=p_company_id AND period_from<=p_period_to AND period_to>=p_period_from
      AND (status='filed' OR p_status='filed')
  ) THEN RAISE EXCEPTION 'overlapping vat filing period'; END IF;

  WITH summary AS (
    SELECT get_vat_return_summary(p_company_id,p_period_from,p_period_to) value
  ), inserted AS (
    INSERT INTO vat_return_filings(company_id,period_from,period_to,output_vat,input_vat,net_vat,
      total_sales,total_purchases,status,filed_at,filed_by,notes,created_by)
    SELECT p_company_id,p_period_from,p_period_to,
      COALESCE((value->>'outputVat')::NUMERIC,0),COALESCE((value->>'inputVat')::NUMERIC,0),
      COALESCE((value->>'outputVat')::NUMERIC,0)-COALESCE((value->>'inputVat')::NUMERIC,0),
      COALESCE((value->>'totalSales')::NUMERIC,0),COALESCE((value->>'totalPurchases')::NUMERIC,0),
      p_status,CASE WHEN p_status='filed' THEN now() END,CASE WHEN p_status='filed' THEN p_user_id END,
      NULLIF(trim(COALESCE(p_notes,'')),''),p_user_id FROM summary RETURNING *
  ) SELECT * INTO v_filing FROM inserted;
  INSERT INTO audit_log(company_id,user_id,action,entity_type,entity_id,new_values)
  VALUES(p_company_id,p_user_id,'create','vat_return_filing',v_filing.id,to_jsonb(v_filing));
  RETURN to_jsonb(v_filing);
END;
$$;

REVOKE ALL ON FUNCTION public.guard_invoice_tax_document() FROM PUBLIC,anon,authenticated;
REVOKE ALL ON FUNCTION public.guard_posted_invoice_line() FROM PUBLIC,anon,authenticated;
REVOKE ALL ON FUNCTION public.create_vat_return_filing_atomic(UUID,DATE,DATE,TEXT,TEXT,UUID) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.create_vat_return_filing_atomic(UUID,DATE,DATE,TEXT,TEXT,UUID) TO service_role;

COMMIT;
