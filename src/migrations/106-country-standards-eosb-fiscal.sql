-- 106: IAS 19 EOSB as non-current; operating revenue name; posting requires an open year.

-- مكافأة نهاية الخدمة التزام طويل الأجل (خصوم غير متداولة) لا متداول.
UPDATE accounts child
SET parent_id = parent.id
FROM accounts parent
WHERE child.company_id = parent.company_id
  AND child.code = '2190'
  AND parent.code = '2200'
  AND (child.parent_id IS DISTINCT FROM parent.id);

UPDATE accounts
SET name = 'إيرادات النشاط',
    name_en = COALESCE(NULLIF(name_en, ''), 'Operating Revenue')
WHERE code = '4100'
  AND name IN ('إيرادات مقاولات', 'إيرادات النشاط');

-- أي ترحيل (عدا إقفال/عكس) يحتاج سنة مالية مفتوحة تغطي التاريخ.
CREATE OR REPLACE FUNCTION public.enforce_open_fiscal_year()
RETURNS TRIGGER LANGUAGE plpgsql SET search_path = public AS $$
BEGIN
  PERFORM pg_advisory_xact_lock(hashtextextended('fiscal-ledger:'||NEW.company_id::TEXT,0));
  IF NEW.type IN ('closing','reversing') THEN RETURN NEW; END IF;
  IF EXISTS (
    SELECT 1 FROM fiscal_years
    WHERE company_id=NEW.company_id AND status='closed'
      AND NEW.date BETWEEN start_date AND end_date
  ) THEN
    RAISE EXCEPTION 'لا يمكن الترحيل إلى سنة مالية مقفلة';
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM fiscal_years
    WHERE company_id=NEW.company_id AND status='open'
      AND NEW.date BETWEEN start_date AND end_date
  ) THEN
    RAISE EXCEPTION 'لا توجد سنة مالية مفتوحة تغطي تاريخ العملية';
  END IF;
  RETURN NEW;
END;
$$;
