-- Allow 'daily_worker' as a contact type so the "عمال يومية" (Daily Workers) section works.
-- The original CHECK constraint only permitted ('client','supplier','subcontractor','both').
--
-- Safely drop ALL existing CHECK constraints that reference the `type`
-- column on `contacts` (there can be more than one if a previous
-- migration recreated them), then add a single unified constraint.
DO $$
DECLARE
  r RECORD;
BEGIN
  FOR r IN
    SELECT conname
      FROM pg_constraint c
      JOIN pg_attribute  a ON a.attrelid = c.conrelid AND a.attnum = ANY(c.conkey)
     WHERE c.conrelid   = 'contacts'::regclass
       AND c.contype    = 'c'
       AND a.attname    = 'type'
  LOOP
    EXECUTE 'ALTER TABLE contacts DROP CONSTRAINT IF EXISTS ' || quote_ident(r.conname);
  END LOOP;

  ALTER TABLE contacts
    ADD CONSTRAINT contacts_type_check
    CHECK (type IN ('client','supplier','subcontractor','both','daily_worker'));
END $$;
