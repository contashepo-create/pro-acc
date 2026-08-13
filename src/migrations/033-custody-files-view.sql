-- ============================================================
-- 033 - View: vw_custody_files
--
-- Read-friendly projection over custodies ("custody files") with
-- employee name and aggregated transaction count.
--
-- Uses security_invoker = on so RLS policies on the underlying
-- tables (custodies, employees, custody_transactions) still apply
-- to the caller (company-scoped isolation).
--
-- Note: older schemas may not have a `reason` column on custodies,
-- so we build the description COALESCE defensively with dynamic SQL.
-- ============================================================

DROP VIEW IF EXISTS public.vw_custody_files;

DO $$
DECLARE
    v_description_expr TEXT;
    v_groupby_extra    TEXT := '';
BEGIN
    IF EXISTS (
        SELECT 1
          FROM information_schema.columns
         WHERE table_schema = 'public'
           AND table_name   = 'custodies'
           AND column_name  = 'reason'
    ) THEN
        v_description_expr := 'COALESCE(c.description, c.reason)';
        v_groupby_extra    := ', c.reason';
    ELSE
        v_description_expr := 'c.description';
    END IF;

    EXECUTE format(
        $sql$
        CREATE OR REPLACE VIEW public.vw_custody_files
        WITH (security_invoker = on) AS
        SELECT
            c.id,
            c.company_id,
            c.employee_id,
            e.name AS employee_name,
            c.amount AS original_amount,
            c.total_received,
            c.total_expenses,
            c.remaining_amount,
            c.status,
            %1$s AS description,
            c.file_number,
            c.created_at,
            COUNT(ct.id) AS transaction_count
        FROM public.custodies c
        LEFT JOIN public.employees e
          ON e.id = c.employee_id
        LEFT JOIN public.custody_transactions ct
          ON ct.custody_id = c.id
        WHERE c.deleted_at IS NULL
        GROUP BY
            c.id,
            c.company_id,
            c.employee_id,
            e.name,
            c.amount,
            c.total_received,
            c.total_expenses,
            c.remaining_amount,
            c.status,
            c.description%2$s,
            c.file_number,
            c.created_at
        $sql$,
        v_description_expr,
        v_groupby_extra
    );
END $$;

-- Grant read access to standard roles (RLS enforced via security_invoker).
GRANT SELECT ON public.vw_custody_files TO authenticated, anon;

SELECT 'Migration 033 completed — vw_custody_files view created' AS result;
