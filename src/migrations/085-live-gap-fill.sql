-- 085: Consolidated gap-fill for environments provisioned from
-- supabase-full-schema.sql which missed later migration pieces.
-- All statements are idempotent; FKs are added only when orphan-free.

ALTER TABLE public.custom_modules ADD COLUMN IF NOT EXISTS updated_at TIMESTAMPTZ DEFAULT now();
ALTER TABLE public.custom_modules ADD COLUMN IF NOT EXISTS code TEXT;
ALTER TABLE public.project_expenses ADD COLUMN IF NOT EXISTS approved_by UUID;
ALTER TABLE public.project_expenses ADD COLUMN IF NOT EXISTS approved_at TIMESTAMPTZ;
ALTER TABLE public.project_expenses ADD COLUMN IF NOT EXISTS status TEXT DEFAULT 'draft';
ALTER TABLE public.payment_methods ADD COLUMN IF NOT EXISTS description TEXT;
ALTER TABLE public.ad_clicks ADD COLUMN IF NOT EXISTS created_at TIMESTAMPTZ DEFAULT now();
ALTER TABLE public.ad_views ADD COLUMN IF NOT EXISTS created_at TIMESTAMPTZ DEFAULT now();
ALTER TABLE public.backup_logs ADD COLUMN IF NOT EXISTS expires_at TIMESTAMPTZ DEFAULT (now() + INTERVAL '30 days');
ALTER TABLE public.security_audit_log ADD COLUMN IF NOT EXISTS user_agent TEXT;
ALTER TABLE public.upgrade_requests ADD COLUMN IF NOT EXISTS receipt_text TEXT;
ALTER TABLE public.custom_actions ADD COLUMN IF NOT EXISTS updated_at TIMESTAMPTZ DEFAULT now();
ALTER TABLE public.financial_audit_log ADD COLUMN IF NOT EXISTS ip_address TEXT;
ALTER TABLE public.company_messages ADD COLUMN IF NOT EXISTS replied_at TIMESTAMPTZ;
ALTER TABLE public.company_messages ADD COLUMN IF NOT EXISTS updated_at TIMESTAMPTZ DEFAULT now();
ALTER TABLE public.company_messages ADD COLUMN IF NOT EXISTS replied_by UUID;

-- rate_limit_buckets: already created by 077-rate-limit-store.sql with the
-- canonical shape (key TEXT PK, hits INTEGER).  Do NOT re-create here.

-- FKs: add only if both sides exist, constraint missing, and no orphans.
DO $$
DECLARE fk RECORD; v_orphans BIGINT;
BEGIN
  FOR fk IN
    SELECT * FROM (VALUES
      ('upgrade_requests','current_plan_id','subscription_plans'),
      ('company_messages','replied_by','users'),
      ('custody_transactions','created_by','users'),
      ('custody_invoices','invoice_id','invoices'),
      ('custody_invoices','purchase_invoice_id','purchase_invoices'),
      ('journal_entries','approved_by','users'),
      ('project_expenses','approved_by','users'),
      ('progress_billing','created_by','users'),
      ('app_settings','updated_by','admin_users')
    ) AS t(tbl,col,ref)
    WHERE EXISTS (SELECT 1 FROM information_schema.tables WHERE table_schema='public' AND table_name=t.tbl)
      AND EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema='public' AND table_name=t.tbl AND column_name=t.col)
      AND EXISTS (SELECT 1 FROM information_schema.tables WHERE table_schema='public' AND table_name=t.ref)
  LOOP
    BEGIN
      IF NOT EXISTS (
        SELECT 1 FROM pg_constraint c
        JOIN pg_attribute a ON a.attrelid=c.conrelid AND a.attnum=ANY(c.conkey)
        WHERE c.contype='f'
          AND c.conrelid = format('public.%I',fk.tbl)::regclass
          AND c.confrelid = format('public.%I',fk.ref)::regclass
          AND a.attname=fk.col
      ) THEN
        EXECUTE format('SELECT count(*) FROM public.%I WHERE %I IS NOT NULL', fk.tbl, fk.col) INTO v_orphans;
        IF v_orphans > 0 THEN
          RAISE NOTICE 'skip %.% (orphan rows)', fk.tbl, fk.col;
        ELSE
          EXECUTE format('ALTER TABLE public.%I ADD CONSTRAINT %I_fk_%I FOREIGN KEY (%I) REFERENCES public.%I(id)',
            fk.tbl, fk.tbl, fk.col, fk.col, fk.ref);
        END IF;
      END IF;
    EXCEPTION WHEN OTHERS THEN
      RAISE NOTICE 'skip %.% (%)', fk.tbl, fk.col, SQLERRM;
    END;
  END LOOP;
END;
$$;
