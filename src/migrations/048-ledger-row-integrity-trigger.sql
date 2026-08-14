-- 048 - Last-line database integrity for all ledger writers.
-- Service-role API access bypasses RLS, so every direct insert path must still
-- prove that related records belong to the same tenant and that a journal line
-- is a real one-sided accounting posting.

CREATE OR REPLACE FUNCTION public.enforce_journal_line_integrity()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public
AS $$
BEGIN
  IF NEW.company_id IS NULL OR NEW.journal_entry_id IS NULL OR NEW.account_id IS NULL THEN
    RAISE EXCEPTION 'company_id, journal_entry_id and account_id are required';
  END IF;
  IF COALESCE(NEW.debit, 0) < 0 OR COALESCE(NEW.credit, 0) < 0
     OR (COALESCE(NEW.debit, 0) = 0 AND COALESCE(NEW.credit, 0) = 0)
     OR (COALESCE(NEW.debit, 0) > 0 AND COALESCE(NEW.credit, 0) > 0)
     OR NEW.debit <> ROUND(NEW.debit, 2) OR NEW.credit <> ROUND(NEW.credit, 2) THEN
    RAISE EXCEPTION 'journal line must have exactly one positive 2-decimal debit or credit';
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM journal_entries e
    WHERE e.id = NEW.journal_entry_id AND e.company_id = NEW.company_id
  ) THEN
    RAISE EXCEPTION 'journal entry does not belong to journal line company';
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM accounts a
    WHERE a.id = NEW.account_id AND a.company_id = NEW.company_id
      AND COALESCE(a.is_active, true) = true AND COALESCE(a.is_header, false) = false
  ) THEN
    RAISE EXCEPTION 'posting account is invalid, inactive, header, or foreign';
  END IF;
  IF NEW.contact_id IS NOT NULL AND NOT EXISTS (
    SELECT 1 FROM contacts c WHERE c.id = NEW.contact_id AND c.company_id = NEW.company_id
  ) THEN
    RAISE EXCEPTION 'contact does not belong to journal line company';
  END IF;
  IF NEW.project_id IS NOT NULL AND NOT EXISTS (
    SELECT 1 FROM projects p WHERE p.id = NEW.project_id AND p.company_id = NEW.company_id
  ) THEN
    RAISE EXCEPTION 'project does not belong to journal line company';
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_enforce_journal_line_integrity ON public.journal_lines;
CREATE TRIGGER trg_enforce_journal_line_integrity
BEFORE INSERT OR UPDATE OF company_id, journal_entry_id, account_id, debit, credit, contact_id, project_id
ON public.journal_lines
FOR EACH ROW EXECUTE FUNCTION public.enforce_journal_line_integrity();
