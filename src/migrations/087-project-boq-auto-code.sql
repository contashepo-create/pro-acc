-- ============================================================================
-- 087: Auto-generate BOQ codes for items created through the project modal.
--
-- create_project_atomic and update_project_atomic (v50_internal) insert their
-- BOQ items without an item_code/code, so projects built in the "إضافة/تعديل
-- مشروع" window used to end up with blank codes. A BEFORE INSERT trigger on
-- boq_items fills a project-scoped BOQ-#### code whenever the row carries no
-- explicit code, covering the project create/edit path (and any other path
-- that inserts BOQ items). A caller-supplied code is left untouched.
--
-- Reuses the same advisory-lock key and BOQ-#### format as
-- create_boq_item_atomic (migration 086) so the two never race on a sequence.
-- ============================================================================

CREATE OR REPLACE FUNCTION public.boq_auto_item_code()
RETURNS TRIGGER LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
DECLARE v_seq INTEGER;
BEGIN
  IF TG_OP='INSERT' AND NEW.company_id IS NOT NULL AND NEW.project_id IS NOT NULL
    AND (NEW.item_code IS NULL OR BTRIM(NEW.item_code)='' OR NEW.code IS NULL OR BTRIM(NEW.code)='') THEN
    PERFORM pg_advisory_xact_lock(hashtextextended(NEW.company_id::TEXT||':boq-code:'||NEW.project_id::TEXT,0));
    SELECT COALESCE(MAX((regexp_match(COALESCE(item_code,code,''),'([0-9]+)$'))[1]::INTEGER),0)+1
      INTO v_seq FROM boq_items
      WHERE company_id=NEW.company_id AND project_id=NEW.project_id AND COALESCE(item_code,code,'') ~ '[0-9]+$';
    LOOP
      NEW.item_code := 'BOQ-'||LPAD(v_seq::TEXT,4,'0');
      NEW.code := NEW.item_code;
      EXIT WHEN NOT EXISTS(
        SELECT 1 FROM boq_items WHERE company_id=NEW.company_id AND project_id=NEW.project_id
          AND LOWER(COALESCE(item_code,code,''))=LOWER(NEW.item_code)
      );
      v_seq := v_seq + 1;
    END LOOP;
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_boq_auto_item_code ON boq_items;
CREATE TRIGGER trg_boq_auto_item_code
  BEFORE INSERT ON boq_items
  FOR EACH ROW EXECUTE FUNCTION public.boq_auto_item_code();

-- The trigger helper is internal: only the safety trigger (and the lifecycle
-- functions that already run as service_role) may use it.
REVOKE ALL ON FUNCTION public.boq_auto_item_code() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.boq_auto_item_code() TO service_role;
