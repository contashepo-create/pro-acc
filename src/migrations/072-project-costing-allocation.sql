-- ============================================================================
-- 072: Project costing — direct labor allocation & overhead (indirect) costs
--
-- Follows international construction-accounting practice (Sage 300 CRE,
-- QuickBooks for Contractors, Viewpoint, NetSuite job costing):
--
--  1. DIRECT LABOR -> project
--     Each salary-sheet item (an employee's salary line) can now carry an
--     optional project_id. When the salary sheet is eventually posted to the
--     ledger, the direct-labour cost is attributed to that project — the same
--     "tag payroll lines to job + cost code" pattern the majors use.
--     (Base wages live on account 5210 / direct labour 5120 and are
--     recognised as project labour by the shared cost classifier.)
--
--  2. INDIRECT / OVERHEAD costs -> project
--     A company may define one or more overhead-allocation rules. Each rule
--     picks an allocation basis and a rate:
--        basis = 'direct_cost'  -> allocated = rate x project direct cost
--        basis = 'direct_labor' -> allocated = rate x project direct labour
--     This mirrors Sage 300's overhead-type-and-rate-on-a-cost-category and
--     the standard "percentage of direct cost / direct labour" methods. The
--     allocated amount is reported SEPARATELY from direct costs so true job
--     profitability can be seen (direct profit vs. profit after overhead).
-- ============================================================================

-- ---------------------------------------------------------------------------
-- 1) Direct labor -> project: salary item carries an optional project.
-- ---------------------------------------------------------------------------
ALTER TABLE salary_items
  ADD COLUMN IF NOT EXISTS project_id UUID REFERENCES projects(id);

CREATE INDEX IF NOT EXISTS idx_salary_items_project
  ON salary_items(company_id, project_id);

-- Tenant guard: a salary item's project must belong to the same company as the
-- item (mirrors the guard used by the other project-cost entry points).
CREATE OR REPLACE FUNCTION public.guard_salary_item_project_tenant()
RETURNS TRIGGER LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
BEGIN
  IF NEW.project_id IS NOT NULL AND NOT EXISTS(
    SELECT 1 FROM projects WHERE id=NEW.project_id AND company_id=NEW.company_id
  ) THEN
    RAISE EXCEPTION 'salary item project tenant mismatch';
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_guard_salary_item_project_tenant ON salary_items;
CREATE TRIGGER trg_guard_salary_item_project_tenant
  BEFORE INSERT OR UPDATE ON salary_items
  FOR EACH ROW EXECUTE FUNCTION public.guard_salary_item_project_tenant();

-- ---------------------------------------------------------------------------
-- 2) Overhead (indirect) allocation rules
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS overhead_allocations (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id UUID NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  allocation_basis TEXT NOT NULL DEFAULT 'direct_cost'
    CHECK (allocation_basis IN ('direct_cost', 'direct_labor')),
  rate NUMERIC(10,4) NOT NULL DEFAULT 0
    CHECK (rate >= 0 AND rate <= 1 AND rate = ROUND(rate, 4)),
  is_active BOOLEAN NOT NULL DEFAULT TRUE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE(company_id, name)
);

CREATE INDEX IF NOT EXISTS idx_overhead_allocations_company
  ON overhead_allocations(company_id, is_active);

-- Update timestamp on rule edits.
CREATE OR REPLACE FUNCTION public.touch_overhead_allocation()
RETURNS TRIGGER LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
BEGIN
  NEW.updated_at := NOW();
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_touch_overhead_allocation ON overhead_allocations;
CREATE TRIGGER trg_touch_overhead_allocation
  BEFORE UPDATE ON overhead_allocations
  FOR EACH ROW EXECUTE FUNCTION public.touch_overhead_allocation();

REVOKE ALL ON TABLE public.overhead_allocations FROM PUBLIC, anon, authenticated;

ALTER TABLE public.overhead_allocations ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation_overhead_allocations ON public.overhead_allocations;
CREATE POLICY tenant_isolation_overhead_allocations ON public.overhead_allocations
  FOR ALL
  USING (company_id = public.tenant_company_id())
  WITH CHECK (company_id = public.tenant_company_id());

-- ---------------------------------------------------------------------------
-- 3) Per-project costing + allocated overhead (single source for reports)
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.get_project_costing_overhead(
  p_company_id UUID,
  p_project_ids UUID[] DEFAULT NULL,
  p_from DATE DEFAULT NULL,
  p_to DATE DEFAULT NULL
) RETURNS TABLE(
  project_id UUID,
  direct_cost NUMERIC,
  direct_labor NUMERIC,
  allocated_overhead NUMERIC,
  allocation_basis TEXT,
  rate NUMERIC
) LANGUAGE sql SECURITY DEFINER SET search_path=public STABLE AS $$
  WITH totals AS (
    SELECT jl.project_id,
      COALESCE(sum(CASE WHEN a.type='expense' THEN jl.debit-jl.credit ELSE 0 END),0) AS direct_cost,
      COALESCE(sum(CASE WHEN a.type='expense'
        AND (a.code LIKE '512%' OR a.code LIKE '521%') THEN jl.debit-jl.credit ELSE 0 END),0) AS direct_labor
    FROM journal_lines jl
    JOIN journal_entries je ON je.id=jl.journal_entry_id AND je.company_id=p_company_id
      AND je.deleted_at IS NULL AND (je.status='posted' OR je.reversed_by IS NOT NULL)
    JOIN accounts a ON a.id=jl.account_id AND a.company_id=p_company_id
    JOIN projects p ON p.id=jl.project_id AND p.company_id=p_company_id
    WHERE jl.company_id=p_company_id AND jl.project_id IS NOT NULL
      AND (p_project_ids IS NULL OR jl.project_id=ANY(p_project_ids))
      AND (p_from IS NULL OR je.date>=p_from) AND (p_to IS NULL OR je.date<=p_to)
    GROUP BY jl.project_id
  ),
  rules AS (
    SELECT allocation_basis, rate, row_number() OVER (ORDER BY created_at, id) AS rn
    FROM overhead_allocations
    WHERE company_id=p_company_id AND is_active=TRUE
  ),
  combined AS (
    SELECT t.project_id, t.direct_cost, t.direct_labor,
      COALESCE(sum(r.rate * CASE WHEN r.allocation_basis='direct_labor' THEN t.direct_labor ELSE t.direct_cost END),0) AS allocated_overhead,
      min(r.allocation_basis) AS basis,
      COALESCE(sum(r.rate),0) AS rate
    FROM totals t CROSS JOIN rules r
    GROUP BY t.project_id, t.direct_cost, t.direct_labor
  )
  SELECT t.project_id, t.direct_cost, t.direct_labor,
    COALESCE(c.allocated_overhead,0),
    COALESCE(c.basis, 'direct_cost'),
    COALESCE(c.rate,0)
  FROM totals t LEFT JOIN combined c ON c.project_id=t.project_id;
$$;

REVOKE ALL ON FUNCTION public.get_project_costing_overhead(UUID, UUID[], DATE, DATE)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.get_project_costing_overhead(UUID, UUID[], DATE, DATE)
  TO service_role;

-- ---------------------------------------------------------------------------
-- 4) create_salary_sheet now accepts an optional project_id per item so each
--    employee's labour cost can be allocated to a project (direct labour).
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.create_salary_sheet(
  p_company_id UUID, p_name TEXT, p_month INTEGER, p_year INTEGER,
  p_date DATE, p_items JSONB
) RETURNS JSONB LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
DECLARE v_sheet salary_sheets%ROWTYPE; v_item JSONB; v_employee UUID; v_project UUID;
  v_basic NUMERIC; v_allowances NUMERIC; v_deductions NUMERIC;
BEGIN
  IF NULLIF(BTRIM(p_name),'') IS NULL OR LENGTH(p_name)>200 OR p_month NOT BETWEEN 1 AND 12 OR p_year NOT BETWEEN 2000 AND 9999 THEN
    RAISE EXCEPTION 'بيانات كشف الرواتب غير صالحة';
  END IF;
  IF jsonb_typeof(COALESCE(p_items,'[]'::JSONB))<>'array' OR jsonb_array_length(COALESCE(p_items,'[]'::JSONB))>1000 THEN
    RAISE EXCEPTION 'بنود كشف الرواتب غير صالحة';
  END IF;
  INSERT INTO salary_sheets(company_id,name,month,year,date,status)
  VALUES(p_company_id,BTRIM(p_name),p_month,p_year,p_date,'draft') RETURNING * INTO v_sheet;
  FOR v_item IN SELECT value FROM jsonb_array_elements(COALESCE(p_items,'[]'::JSONB))
  LOOP
    BEGIN
      v_employee:=(v_item->>'employee_id')::UUID;
      v_basic:=COALESCE((v_item->>'basic_salary')::NUMERIC,0);
      v_allowances:=COALESCE((v_item->>'allowances')::NUMERIC,0);
      v_deductions:=COALESCE((v_item->>'deductions')::NUMERIC,0);
      v_project:=NULLIF((v_item->>'project_id')::TEXT,'')::UUID;
    EXCEPTION WHEN invalid_text_representation OR numeric_value_out_of_range THEN
      RAISE EXCEPTION 'أحد بنود كشف الرواتب غير صالح';
    END;
    IF NOT EXISTS(SELECT 1 FROM employees WHERE id=v_employee AND company_id=p_company_id AND COALESCE(is_active,TRUE)=TRUE) THEN
      RAISE EXCEPTION 'أحد الموظفين غير موجود أو غير نشط';
    END IF;
    IF v_project IS NOT NULL AND NOT EXISTS(
      SELECT 1 FROM projects WHERE id=v_project AND company_id=p_company_id AND status='active'
    ) THEN
      RAISE EXCEPTION 'المشروع المرتبط ببند الرواتب غير صالح أو غير نشط';
    END IF;
    IF v_basic<0 OR v_allowances<0 OR v_deductions<0 OR v_basic<>ROUND(v_basic,2)
      OR v_allowances<>ROUND(v_allowances,2) OR v_deductions<>ROUND(v_deductions,2)
      OR v_basic+v_allowances-v_deductions<0 THEN RAISE EXCEPTION 'أحد بنود كشف الرواتب غير صالح'; END IF;
    INSERT INTO salary_items(company_id,sheet_id,employee_id,basic_salary,allowances,deductions,net_pay,project_id)
    VALUES(p_company_id,v_sheet.id,v_employee,v_basic,v_allowances,v_deductions,v_basic+v_allowances-v_deductions,v_project);
  END LOOP;
  RETURN to_jsonb(v_sheet);
END;
$$;

REVOKE ALL ON FUNCTION public.create_salary_sheet(UUID,TEXT,INTEGER,INTEGER,DATE,JSONB) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.create_salary_sheet(UUID,TEXT,INTEGER,INTEGER,DATE,JSONB) TO service_role;
