-- Allow 'daily_worker' as a contact type so the "عمال يومية" (Daily Workers) section works.
-- The original CHECK constraint only permitted ('client','supplier','subcontractor','both').
DO $$
DECLARE
  cname text;
BEGIN
  SELECT conname INTO cname
  FROM pg_constraint
  WHERE conrelid = 'contacts'::regclass
    AND contype = 'c'
    AND pg_get_constraintdef(oid) LIKE '%type IN%';

  IF cname IS NOT NULL THEN
    EXECUTE 'ALTER TABLE contacts DROP CONSTRAINT ' || cname;
  END IF;

  EXECUTE 'ALTER TABLE contacts ADD CONSTRAINT contacts_type_check CHECK (type IN (''client'',''supplier'',''subcontractor'',''both'',''daily_worker''))';
END $$;
