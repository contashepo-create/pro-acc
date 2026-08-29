-- 111: Add the missing FK tenders.contact_id -> contacts(id).
--
-- 018 declared tenders.contact_id as a bare UUID. 060's atomic writers
-- (create/update_tender_atomic) validate that any value they write is a
-- contact of the same company, but without the constraint PostgREST's
-- schema cache knows nothing about the relationship, so the tenders list
-- and detail routes fail with PGRST200 ("Could not find a relationship
-- between 'tenders' and 'contacts'") when embedding contacts(name). Every
-- other table the app embeds contacts from (contracts, bonds, invoices,
-- quotations, projects, ...) has a real FK; this makes tenders conform to
-- the same convention (plain REFERENCES, NO ACTION on delete, as
-- contracts.contact_id does).
--
-- Before the constraint can exist, clear legacy rows (written before 060's
-- guards, or hand-edited in production) whose contact no longer exists or
-- belongs to another tenant. The same-tenant check is deliberate: a value
-- pointing at another company's contact would pass the FK but leak that
-- contact's name through the embed, while 060's semantics require the
-- contact to belong to the tender's company. Nulling matches the embed
-- behaviour the UI already expects (contacts(name) -> null) and the list
-- still shows the free-text client_name.

DO $$
DECLARE v_count INTEGER;
BEGIN
  UPDATE tenders t
  SET contact_id = NULL
  WHERE t.contact_id IS NOT NULL
    AND NOT EXISTS (
      SELECT 1 FROM contacts c
      WHERE c.id = t.contact_id AND c.company_id = t.company_id
    );
  GET DIAGNOSTICS v_count = ROW_COUNT;
  RAISE NOTICE '111: nullified % legacy tenders.contact_id value(s) pointing at missing or cross-tenant contacts', v_count;
END $$;

ALTER TABLE tenders
  ADD CONSTRAINT tenders_contact_id_fkey
  FOREIGN KEY (contact_id) REFERENCES contacts(id);

SELECT 'Migration 111 completed — tenders.contact_id FK to contacts' as result;
