-- ============================================================
-- 076 — Posted-journal immutability + whole-entry balance
--
-- Two ledger invariants were previously held only by application code and the
-- atomic RPCs. Because every API route writes through the service role
-- (which bypasses RLS), a direct write — or any future route that forgets an
-- application check — could still mutate or delete a posted entry, or create
-- an entry whose debit/credit totals do not match. Both invariants are now
-- enforced in the database itself, on EVERY write path:
--
--   1. Immutability of completed entries. A journal entry that carries lines
--      cannot be deleted, and its financial fields cannot change. The only
--      writes allowed are:
--        * audit/reversal links: reference_type, reference_id, reversal_of,
--          reversed_by (written by the audited reversal/lifecycle functions);
--        * the approval lifecycle: posted -> pending (approval request),
--          pending -> posted (approval, stamping approved_by/approved_at),
--          pending -> rejected (rejection);
--        * the company-wide reset flow (app.business_data_reset), the same
--          transaction-scoped escape hatch every other tenant guard uses.
--      The sole supported way to undo a completed entry remains the reversing
--      entry, which keeps the original in the audit trail.
--
--   2. Whole-entry balance at COMMIT. A DEFERRABLE INITIALLY DEFERRED
--      constraint trigger on journal_lines verifies at commit that every
--      entry which has lines is exactly balanced (SUM(debit) = SUM(credit),
--      no tolerance: NUMERIC(15,2) is exact). Direct multi-line inserts, line
--      edits, or line deletions that would leave an entry unbalanced abort the
--      transaction instead of corrupting the ledger. An entry without lines is
--      exempt: it is either in the brief header-then-lines creation window or
--      an orphan awaiting the writer's cleanup, and it carries no ledger data
--      (zero/zero lines are impossible — the row-integrity trigger from 048
--      rejects them, so "sums are 0" unambiguously means "no lines").
--
-- Idempotent by design (CREATE OR REPLACE / DROP TRIGGER IF EXISTS /
-- DROP CONSTRAINT IF EXISTS), matching the rest of the chain.
-- ============================================================

-- ---------- 1) Immutability guard (BEFORE UPDATE OR DELETE) ----------

CREATE OR REPLACE FUNCTION public.guard_journal_entry_immutability()
RETURNS TRIGGER
LANGUAGE plpgsql
SET search_path = public
AS $$
DECLARE
  v_company UUID := COALESCE(NEW.company_id, OLD.company_id);
BEGIN
  -- Company-wide reset (reset_company_business_data) intentionally wipes the
  -- tenant's ledger; every other tenant guard honours this same GUC.
  IF current_setting('app.business_data_reset', TRUE) = v_company::TEXT THEN
    IF TG_OP = 'DELETE' THEN RETURN OLD; ELSE RETURN NEW; END IF;
  END IF;

  -- A line-less header is not a completed entry: it is either mid-creation
  -- (its lines follow in the writer's next statement) or an orphan the
  -- writer is cleaning up after a failed line insert. Allow the cleanup.
  IF NOT EXISTS (SELECT 1 FROM journal_lines WHERE journal_entry_id = OLD.id) THEN
    IF TG_OP = 'DELETE' THEN RETURN OLD; ELSE RETURN NEW; END IF;
  END IF;

  IF TG_OP = 'DELETE' THEN
    RAISE EXCEPTION 'posted journal entry cannot be deleted; reverse it with post_journal_reversal instead'
      USING ERRCODE = '23514';
  END IF;

  -- Financial and audit fields of a completed entry are immutable. The
  -- remaining columns (reference_type, reference_id, reversal_of,
  -- reversed_by, status, and approved_by/approved_at while not posted) are
  -- checked below; anything else changing is tampering.
  IF NEW.id IS DISTINCT FROM OLD.id
     OR NEW.company_id IS DISTINCT FROM OLD.company_id
     OR NEW.number IS DISTINCT FROM OLD.number
     OR NEW.date IS DISTINCT FROM OLD.date
     OR NEW.type IS DISTINCT FROM OLD.type
     OR NEW.description IS DISTINCT FROM OLD.description
     OR NEW.project_id IS DISTINCT FROM OLD.project_id
     OR NEW.created_by IS DISTINCT FROM OLD.created_by
     OR NEW.created_at IS DISTINCT FROM OLD.created_at
     OR NEW.cost_center_id IS DISTINCT FROM OLD.cost_center_id
     OR NEW.branch_id IS DISTINCT FROM OLD.branch_id
     OR NEW.deleted_at IS DISTINCT FROM OLD.deleted_at
     OR NEW.reference IS DISTINCT FROM OLD.reference THEN
    RAISE EXCEPTION 'posted journal entry is immutable; post a reversing entry instead of editing it'
      USING ERRCODE = '23514';
  END IF;

  -- Approval metadata may only be stamped while the entry is not posted.
  IF COALESCE(OLD.status, 'posted') = 'posted'
     AND (NEW.approved_by IS DISTINCT FROM OLD.approved_by
          OR NEW.approved_at IS DISTINCT FROM OLD.approved_at) THEN
    RAISE EXCEPTION 'posted journal entry is immutable; post a reversing entry instead of editing it'
      USING ERRCODE = '23514';
  END IF;

  -- Status may only follow the documented lifecycle transitions.
  IF NEW.status IS DISTINCT FROM OLD.status AND NOT (
       (COALESCE(OLD.status, 'posted') = 'posted' AND NEW.status = 'pending')
    OR (COALESCE(OLD.status, 'posted') = 'pending' AND NEW.status IN ('posted', 'rejected'))
  ) THEN
    RAISE EXCEPTION 'invalid journal entry status transition % -> %', OLD.status, NEW.status
      USING ERRCODE = '23514';
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_guard_journal_entry_immutability ON public.journal_entries;
CREATE TRIGGER trg_guard_journal_entry_immutability
BEFORE UPDATE OR DELETE ON public.journal_entries
FOR EACH ROW EXECUTE FUNCTION public.guard_journal_entry_immutability();

-- ---------- 2) Whole-entry balance, enforced at COMMIT ----------

-- A constraint-trigger function is an ordinary row trigger function; the
-- constraint (DEFERRABLE INITIALLY DEFERRED) is declared on the ALTER TABLE
-- below.
CREATE OR REPLACE FUNCTION public.check_journal_entry_balance()
RETURNS TRIGGER
LANGUAGE plpgsql
SET search_path = public
AS $$
DECLARE
  v_company UUID := COALESCE(NEW.company_id, OLD.company_id);
  v_entry_id UUID := COALESCE(NEW.journal_entry_id, OLD.journal_entry_id);
  v_debit NUMERIC;
  v_credit NUMERIC;
BEGIN
  -- The company-wide reset removes the whole ledger; mirror the row guard.
  IF v_company IS NOT NULL
     AND current_setting('app.business_data_reset', TRUE) = v_company::TEXT THEN
    RETURN NULL;
  END IF;
  SELECT COALESCE(SUM(debit), 0), COALESCE(SUM(credit), 0)
    INTO v_debit, v_credit
    FROM journal_lines
   WHERE journal_entry_id = v_entry_id;
  IF v_debit = 0 AND v_credit = 0 THEN
    -- No lines committed for this entry (creation window / orphan cleanup):
    -- there is no ledger data to balance yet.
    RETURN NULL;
  END IF;
  IF v_debit IS DISTINCT FROM v_credit THEN
    RAISE EXCEPTION 'journal entry % is unbalanced: debit total % <> credit total %',
      v_entry_id, v_debit, v_credit
      USING ERRCODE = '23514';
  END IF;
  RETURN NULL;
END;
$$;

-- Constraint triggers are dropped with the plain DROP TRIGGER statement.
DROP TRIGGER IF EXISTS trg_chk_journal_entry_balanced ON public.journal_lines;
CREATE CONSTRAINT TRIGGER trg_chk_journal_entry_balanced
AFTER INSERT OR UPDATE OR DELETE ON public.journal_lines
DEFERRABLE INITIALLY DEFERRED
FOR EACH ROW EXECUTE FUNCTION public.check_journal_entry_balance();
