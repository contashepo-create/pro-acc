-- 069 - Fiscal-year controls: one open year, and ledger postings must fall
-- within an open fiscal year.
--
-- Answering three accounting controls that were previously missing:
--   1. Every company now has an open fiscal year from the moment it is created
--      (bootstrap trigger) and any legacy company without one is backfilled.
--   2. Ledger postings dated inside a closed year, or outside every open year,
--      are rejected (closing/reversing system entries are exempt).
--   3. A company can never hold two open fiscal years at once.

-- 1) Backfill: any existing company that has no fiscal years at all gets the
--    current calendar year as its open fiscal year.
DO $$
DECLARE v_year INTEGER := EXTRACT(YEAR FROM CURRENT_DATE)::INTEGER;
BEGIN
  INSERT INTO fiscal_years(company_id, name, start_date, end_date, status)
  SELECT c.id, 'السنة المالية ' || v_year,
         make_date(v_year, 1, 1), make_date(v_year, 12, 31), 'open'
  FROM companies c
  WHERE NOT EXISTS (SELECT 1 FROM fiscal_years fy WHERE fy.company_id = c.id)
  ON CONFLICT DO NOTHING;
END;
$$;

-- 2) Hard invariant: only ONE open fiscal year per company.
CREATE UNIQUE INDEX IF NOT EXISTS uq_fiscal_year_single_open
  ON fiscal_years(company_id) WHERE status = 'open';

-- 3) Bootstrap new companies with the current calendar year as their open
--    fiscal year. Covers registration, first-run setup, and any other path
--    that inserts a company row.
CREATE OR REPLACE FUNCTION public.bootstrap_company_fiscal_year()
RETURNS TRIGGER LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
DECLARE v_year INTEGER := EXTRACT(YEAR FROM CURRENT_DATE)::INTEGER;
BEGIN
  INSERT INTO fiscal_years(company_id, name, start_date, end_date, status)
  VALUES (NEW.id, 'السنة المالية ' || v_year, make_date(v_year,1,1), make_date(v_year,12,31), 'open')
  ON CONFLICT (company_id, name) DO NOTHING;
  RETURN NEW;
END;
$$;
DROP TRIGGER IF EXISTS trg_company_fiscal_year_bootstrap ON companies;
CREATE TRIGGER trg_company_fiscal_year_bootstrap AFTER INSERT ON companies
  FOR EACH ROW EXECUTE FUNCTION public.bootstrap_company_fiscal_year();

-- 4) DB-enforced non-overlap of fiscal periods. Covers BOTH creation and the
--    edit path (a later date change can silently create an overlap otherwise).
CREATE OR REPLACE FUNCTION public.guard_fiscal_year_no_overlap()
RETURNS TRIGGER LANGUAGE plpgsql SET search_path=public AS $$
BEGIN
  IF EXISTS(SELECT 1 FROM fiscal_years
    WHERE company_id=NEW.company_id AND id IS DISTINCT FROM NEW.id
      AND start_date<=NEW.end_date AND end_date>=NEW.start_date)
  THEN RAISE EXCEPTION 'الفترة المالية تتداخل مع فترة موجودة';
  END IF;
  RETURN NEW;
END;
$$;
DROP TRIGGER IF EXISTS trg_guard_fiscal_year_no_overlap ON fiscal_years;
CREATE TRIGGER trg_guard_fiscal_year_no_overlap
  BEFORE INSERT OR UPDATE OF start_date,end_date,company_id ON fiscal_years
  FOR EACH ROW EXECUTE FUNCTION public.guard_fiscal_year_no_overlap();

-- 5) Clear error when a transition would open a second fiscal year (e.g. the
--    reopen path). The unique index above is the hard backstop.
CREATE OR REPLACE FUNCTION public.guard_single_open_fiscal_year()
RETURNS TRIGGER LANGUAGE plpgsql SET search_path=public AS $$
BEGIN
  IF NEW.status='open' AND OLD.status<>'open' AND EXISTS(
    SELECT 1 FROM fiscal_years
    WHERE company_id=NEW.company_id AND status='open' AND id<>NEW.id
  ) THEN
    RAISE EXCEPTION 'لا يمكن فتح أكثر من سنة مالية واحدة في نفس الوقت';
  END IF;
  RETURN NEW;
END;
$$;
DROP TRIGGER IF EXISTS trg_guard_single_open_fiscal_year ON fiscal_years;
CREATE TRIGGER trg_guard_single_open_fiscal_year BEFORE UPDATE OF status ON fiscal_years
  FOR EACH ROW EXECUTE FUNCTION public.guard_single_open_fiscal_year();

-- 6) Strict posting guard. An entry dated inside a CLOSED year is rejected,
--    and once a company has fiscal years, an entry dated outside every OPEN
--    year is rejected. Closing/reversing entries are system entries and are
--    exempt from the guard.
CREATE OR REPLACE FUNCTION public.enforce_open_fiscal_year()
RETURNS TRIGGER LANGUAGE plpgsql SET search_path = public AS $$
BEGIN
  -- Serialize every ledger write with fiscal close/reopen for this tenant.
  PERFORM pg_advisory_xact_lock(hashtextextended('fiscal-ledger:'||NEW.company_id::TEXT,0));
  IF NEW.type IN ('closing','reversing') THEN RETURN NEW; END IF;
  IF EXISTS (SELECT 1 FROM fiscal_years WHERE company_id=NEW.company_id AND status='closed'
    AND NEW.date BETWEEN start_date AND end_date) THEN
    RAISE EXCEPTION 'لا يمكن الترحيل إلى سنة مالية مقفلة';
  END IF;
  IF EXISTS (SELECT 1 FROM fiscal_years WHERE company_id=NEW.company_id)
    AND NOT EXISTS (SELECT 1 FROM fiscal_years WHERE company_id=NEW.company_id AND status='open'
      AND NEW.date BETWEEN start_date AND end_date) THEN
    RAISE EXCEPTION 'لا توجد سنة مالية مفتوحة تغطي تاريخ العملية';
  END IF;
  RETURN NEW;
END;
$$;

-- 7) Atomic fiscal-year creation: validates dates, blocks date overlaps and a
--    second open year, and records an audit entry (the app previously checked
--    overlaps with a racy read-then-write).
CREATE OR REPLACE FUNCTION public.create_fiscal_year_atomic(
  p_company_id UUID, p_name TEXT, p_start_date DATE, p_end_date DATE, p_user_id UUID
) RETURNS JSONB LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
DECLARE v_year fiscal_years%ROWTYPE;
BEGIN
  IF NOT EXISTS(SELECT 1 FROM users WHERE id=p_user_id AND company_id=p_company_id AND is_active=TRUE)
  THEN RAISE EXCEPTION 'المستخدم غير صالح'; END IF;
  IF NULLIF(BTRIM(p_name),'') IS NULL OR LENGTH(p_name)>200 OR p_start_date IS NULL OR p_end_date IS NULL
    OR p_end_date < p_start_date THEN RAISE EXCEPTION 'بيانات السنة المالية غير صالحة'; END IF;
  PERFORM pg_advisory_xact_lock(hashtextextended('fiscal-year:'||p_company_id::TEXT,0));
  IF EXISTS(SELECT 1 FROM fiscal_years WHERE company_id=p_company_id
    AND start_date<=p_end_date AND end_date>=p_start_date)
  THEN RAISE EXCEPTION 'الفترة المالية تتداخل مع فترة موجودة'; END IF;
  IF EXISTS(SELECT 1 FROM fiscal_years WHERE company_id=p_company_id AND status='open')
  THEN RAISE EXCEPTION 'لا يمكن فتح أكثر من سنة مالية واحدة في نفس الوقت'; END IF;
  INSERT INTO fiscal_years(company_id,name,start_date,end_date,status)
  VALUES(p_company_id,BTRIM(p_name),p_start_date,p_end_date,'open') RETURNING * INTO v_year;
  INSERT INTO audit_log(company_id,user_id,action,entity_type,entity_id,new_values)
  VALUES(p_company_id,p_user_id,'create','fiscal_year',v_year.id,to_jsonb(v_year));
  RETURN to_jsonb(v_year);
END;
$$;
REVOKE ALL ON FUNCTION public.create_fiscal_year_atomic(UUID,TEXT,DATE,DATE,UUID) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.create_fiscal_year_atomic(UUID,TEXT,DATE,DATE,UUID) TO service_role;
