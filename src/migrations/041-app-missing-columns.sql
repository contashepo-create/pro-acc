-- ============================================================
-- 041 - Columns the app writes but schema is missing
--
-- Static analysis of every .insert(/.update(/.upsert( payload across
-- the API surfaced columns the code writes that are not in any
-- existing migration. This idempotent migration adds them all so
-- writes don't silently drop fields or throw 42703 errors.
-- ============================================================

BEGIN;

-- ------------- notifications -------------
-- Code writes approval_request / approval_response / subscription / push /
-- support_update / addon_granted / closing, and entity_type / entity_id / body.
ALTER TABLE notifications DROP CONSTRAINT IF EXISTS notifications_type_check;
ALTER TABLE notifications ADD CONSTRAINT notifications_type_check
  CHECK (type IN (
    'info','warning','success','error',
    'subscription','upgrade','addon_granted',
    'approval_request','approval_response','approval_approved','approval_rejected',
    'push','support_update','closing'
  ));
ALTER TABLE notifications ADD COLUMN IF NOT EXISTS entity_type TEXT;
ALTER TABLE notifications ADD COLUMN IF NOT EXISTS entity_id   UUID;
ALTER TABLE notifications ADD COLUMN IF NOT EXISTS body        TEXT;
ALTER TABLE notifications ADD COLUMN IF NOT EXISTS read_at     TIMESTAMPTZ;
ALTER TABLE notifications ADD COLUMN IF NOT EXISTS push_sent   BOOLEAN DEFAULT false;
CREATE INDEX IF NOT EXISTS idx_notifications_entity ON notifications(entity_type, entity_id);

-- ------------- subscriptions -------------
ALTER TABLE subscriptions ADD COLUMN IF NOT EXISTS subscriber_number TEXT;
CREATE INDEX IF NOT EXISTS idx_subscriptions_subscriber_number ON subscriptions(subscriber_number);
-- subscriber_number sequence used by admin companies endpoint
CREATE SEQUENCE IF NOT EXISTS subscriber_number_seq START 1000;

-- ------------- activation_codes (add-ons support) -------------
ALTER TABLE activation_codes ADD COLUMN IF NOT EXISTS addon_type   TEXT CHECK (addon_type IN ('extra_user','extra_branch','storage_gb','plan_upgrade'));
ALTER TABLE activation_codes ADD COLUMN IF NOT EXISTS addon_quantity INT NOT NULL DEFAULT 0;
ALTER TABLE activation_codes ADD COLUMN IF NOT EXISTS plan_duration_months INT;
ALTER TABLE activation_codes ADD COLUMN IF NOT EXISTS notes        TEXT;
ALTER TABLE activation_codes ADD COLUMN IF NOT EXISTS one_time     BOOLEAN DEFAULT true;
CREATE INDEX IF NOT EXISTS idx_activation_codes_addon ON activation_codes(addon_type) WHERE is_used = false;

-- ------------- advertisements (admin + tracking) -------------
ALTER TABLE advertisements ADD COLUMN IF NOT EXISTS views        INT NOT NULL DEFAULT 0;
ALTER TABLE advertisements ADD COLUMN IF NOT EXISTS clicks       INT NOT NULL DEFAULT 0;
ALTER TABLE advertisements ADD COLUMN IF NOT EXISTS display_mode TEXT DEFAULT 'banner' CHECK (display_mode IN ('banner','popup','inline','announcement'));
ALTER TABLE advertisements ADD COLUMN IF NOT EXISTS priority     INT NOT NULL DEFAULT 0;
ALTER TABLE advertisements ADD COLUMN IF NOT EXISTS show_until   TIMESTAMPTZ;

-- ------------- financial_audit_log -------------
ALTER TABLE financial_audit_log ADD COLUMN IF NOT EXISTS before_values JSONB;
ALTER TABLE financial_audit_log ADD COLUMN IF NOT EXISTS after_values  JSONB;
ALTER TABLE financial_audit_log ADD COLUMN IF NOT EXISTS event_date    TIMESTAMPTZ DEFAULT NOW();
ALTER TABLE financial_audit_log ADD COLUMN IF NOT EXISTS total_amount  NUMERIC(15,2);

-- ------------- audit_log (generic) -------------
ALTER TABLE audit_log ADD COLUMN IF NOT EXISTS status     TEXT;
ALTER TABLE audit_log ADD COLUMN IF NOT EXISTS role       TEXT;
ALTER TABLE audit_log ADD COLUMN IF NOT EXISTS is_active  BOOLEAN;
ALTER TABLE audit_log ADD COLUMN IF NOT EXISTS title      TEXT;
ALTER TABLE audit_log ADD COLUMN IF NOT EXISTS value      NUMERIC(15,2);

-- ------------- security_audit_log -------------
ALTER TABLE security_audit_log ADD COLUMN IF NOT EXISTS file_hash TEXT;
ALTER TABLE security_audit_log ADD COLUMN IF NOT EXISTS tables    JSONB;
ALTER TABLE security_audit_log ADD COLUMN IF NOT EXISTS file_size BIGINT;
ALTER TABLE security_audit_log ADD COLUMN IF NOT EXISTS file_type TEXT;
ALTER TABLE security_audit_log ADD COLUMN IF NOT EXISTS event_date TIMESTAMPTZ DEFAULT NOW();
ALTER TABLE security_audit_log ADD COLUMN IF NOT EXISTS approvals_enabled BOOLEAN;
ALTER TABLE security_audit_log ADD COLUMN IF NOT EXISTS is_enabled       BOOLEAN;

-- ------------- companies -------------
ALTER TABLE companies ADD COLUMN IF NOT EXISTS country       TEXT;
ALTER TABLE companies ADD COLUMN IF NOT EXISTS country_code  TEXT DEFAULT 'SA';
ALTER TABLE companies ADD COLUMN IF NOT EXISTS currency_code TEXT DEFAULT 'SAR';
ALTER TABLE companies ADD COLUMN IF NOT EXISTS locale        TEXT DEFAULT 'ar';
ALTER TABLE companies ADD COLUMN IF NOT EXISTS vat_rate      NUMERIC(5,2) DEFAULT 15.00;

-- ------------- contacts -------------
ALTER TABLE contacts ADD COLUMN IF NOT EXISTS created_by UUID REFERENCES users(id);

-- ------------- cash_transactions -------------
ALTER TABLE cash_transactions ADD COLUMN IF NOT EXISTS tax_amount NUMERIC(15,2) DEFAULT 0;
ALTER TABLE cash_transactions ADD COLUMN IF NOT EXISTS tax_rate   NUMERIC(5,2) DEFAULT 0;
ALTER TABLE cash_transactions ADD COLUMN IF NOT EXISTS approved_at TIMESTAMPTZ;
ALTER TABLE cash_transactions ADD COLUMN IF NOT EXISTS approved_by UUID REFERENCES users(id);

-- ------------- purchase_invoices / purchase_orders -------------
ALTER TABLE purchase_invoices ADD COLUMN IF NOT EXISTS approved_at TIMESTAMPTZ;
ALTER TABLE purchase_invoices ADD COLUMN IF NOT EXISTS approved_by UUID REFERENCES users(id);
ALTER TABLE purchase_orders  ADD COLUMN IF NOT EXISTS po_number TEXT;
ALTER TABLE purchase_orders  ADD COLUMN IF NOT EXISTS created_by UUID REFERENCES users(id);
ALTER TABLE purchase_orders  ADD COLUMN IF NOT EXISTS updated_at TIMESTAMPTZ DEFAULT NOW();

-- ------------- invoices / quotations / journal_entries / voucher_* -------------
ALTER TABLE invoices       ADD COLUMN IF NOT EXISTS updated_at TIMESTAMPTZ DEFAULT NOW();
ALTER TABLE quotations     ADD COLUMN IF NOT EXISTS tax_rate NUMERIC(5,2) DEFAULT 15;
ALTER TABLE quotations     ADD COLUMN IF NOT EXISTS created_by UUID REFERENCES users(id);
ALTER TABLE voucher_disbursements ADD COLUMN IF NOT EXISTS updated_at TIMESTAMPTZ DEFAULT NOW();
ALTER TABLE voucher_receipts      ADD COLUMN IF NOT EXISTS updated_at TIMESTAMPTZ DEFAULT NOW();

-- ------------- credit_notes -------------
ALTER TABLE credit_notes ADD COLUMN IF NOT EXISTS contact_id UUID REFERENCES contacts(id);
ALTER TABLE credit_notes ADD COLUMN IF NOT EXISTS project_id UUID REFERENCES projects(id);
ALTER TABLE credit_notes ADD COLUMN IF NOT EXISTS tax_amount NUMERIC(15,2) DEFAULT 0;
ALTER TABLE credit_notes ADD COLUMN IF NOT EXISTS tax_rate   NUMERIC(5,2) DEFAULT 15;
ALTER TABLE credit_note_items ADD COLUMN IF NOT EXISTS company_id UUID REFERENCES companies(id) ON DELETE CASCADE;
UPDATE credit_note_items cni
   SET company_id = cn.company_id
  FROM credit_notes cn
 WHERE cni.credit_note_id = cn.id AND cni.company_id IS NULL;

-- ------------- fixed_assets -------------
ALTER TABLE fixed_assets ADD COLUMN IF NOT EXISTS asset_account_id        UUID REFERENCES accounts(id);
ALTER TABLE fixed_assets ADD COLUMN IF NOT EXISTS depreciation_account_id UUID REFERENCES accounts(id);
ALTER TABLE fixed_assets ADD COLUMN IF NOT EXISTS approved_at TIMESTAMPTZ;

-- ------------- bonds -------------
ALTER TABLE bonds ADD COLUMN IF NOT EXISTS is_released BOOLEAN DEFAULT false;
ALTER TABLE bonds ADD COLUMN IF NOT EXISTS released_at TIMESTAMPTZ;

-- ------------- boq_items -------------
ALTER TABLE boq_items ADD COLUMN IF NOT EXISTS item_code TEXT;

-- ------------- fiscal_years -------------
ALTER TABLE fiscal_years ADD COLUMN IF NOT EXISTS closed_at TIMESTAMPTZ;
ALTER TABLE fiscal_years ADD COLUMN IF NOT EXISTS closed_by UUID REFERENCES users(id);

-- ------------- projects -------------
ALTER TABLE projects ADD COLUMN IF NOT EXISTS description          TEXT;
ALTER TABLE projects ADD COLUMN IF NOT EXISTS location             TEXT;
ALTER TABLE projects ADD COLUMN IF NOT EXISTS budget               NUMERIC(15,2) DEFAULT 0;
ALTER TABLE projects ADD COLUMN IF NOT EXISTS tender_id            UUID REFERENCES tenders(id);
ALTER TABLE projects ADD COLUMN IF NOT EXISTS closed_at            TIMESTAMPTZ;
ALTER TABLE projects ADD COLUMN IF NOT EXISTS closed_by            UUID REFERENCES users(id);
ALTER TABLE projects ADD COLUMN IF NOT EXISTS closure_journal_entry_id UUID REFERENCES journal_entries(id);
ALTER TABLE projects ADD COLUMN IF NOT EXISTS created_by           UUID REFERENCES users(id);
ALTER TABLE projects ADD COLUMN IF NOT EXISTS updated_at           TIMESTAMPTZ DEFAULT NOW();

-- ------------- reminder_log -------------
ALTER TABLE reminder_log ADD COLUMN IF NOT EXISTS sent_at TIMESTAMPTZ;

-- ------------- subcontractor_certificates / contracts / payments -------------
ALTER TABLE subcontractor_certificates ADD COLUMN IF NOT EXISTS description      TEXT;
ALTER TABLE subcontractor_certificates ADD COLUMN IF NOT EXISTS retention_amount NUMERIC(15,2) DEFAULT 0;
ALTER TABLE subcontractor_certificates ADD COLUMN IF NOT EXISTS retention_rate   NUMERIC(5,2) DEFAULT 0;
ALTER TABLE subcontractor_contracts    ADD COLUMN IF NOT EXISTS description      TEXT;
ALTER TABLE subcontractor_contracts    ADD COLUMN IF NOT EXISTS retention_rate   NUMERIC(5,2) DEFAULT 0;
ALTER TABLE subcontractor_payments     ADD COLUMN IF NOT EXISTS created_by       UUID REFERENCES users(id);
ALTER TABLE subcontractor_payments     ADD COLUMN IF NOT EXISTS approved_at      TIMESTAMPTZ;
ALTER TABLE subcontractor_payments     ADD COLUMN IF NOT EXISTS status           TEXT DEFAULT 'paid';

-- ------------- timesheets -------------
ALTER TABLE timesheets ADD COLUMN IF NOT EXISTS is_completed BOOLEAN DEFAULT false;
ALTER TABLE timesheets ADD COLUMN IF NOT EXISTS is_approved  BOOLEAN DEFAULT false;
CREATE INDEX IF NOT EXISTS idx_timesheets_approved ON timesheets(is_approved);

-- ------------- petty_cash_reconciliation -------------
ALTER TABLE petty_cash_reconciliation ADD COLUMN IF NOT EXISTS is_balanced BOOLEAN GENERATED ALWAYS AS (status = 'balanced') STORED;

-- ------------- inventory_transactions / items -------------
ALTER TABLE inventory_transactions ADD COLUMN IF NOT EXISTS approved_at   TIMESTAMPTZ;
ALTER TABLE inventory_transactions ADD COLUMN IF NOT EXISTS status        TEXT DEFAULT 'posted';
ALTER TABLE inventory_transactions ADD COLUMN IF NOT EXISTS journal_entry_id UUID REFERENCES journal_entries(id);
ALTER TABLE inventory_items        ADD COLUMN IF NOT EXISTS updated_at    TIMESTAMPTZ DEFAULT NOW();

-- ------------- employee_advances -------------
ALTER TABLE employee_advances ADD COLUMN IF NOT EXISTS approved_at TIMESTAMPTZ;
ALTER TABLE employee_advances ADD COLUMN IF NOT EXISTS status      TEXT DEFAULT 'paid';

COMMIT;

SELECT 'Migration 041 completed — missing app columns added' AS result;

-- ------------- Fixes from second pass -------------
-- Subscriptions.addons_json/extra_branches are added in 032 but ensure IF NOT EXISTS
ALTER TABLE subscriptions ADD COLUMN IF NOT EXISTS addons_json    JSONB NOT NULL DEFAULT '{}'::jsonb;
ALTER TABLE subscriptions ADD COLUMN IF NOT EXISTS extra_branches INT NOT NULL DEFAULT 0;

-- financial_audit_log: some writes use short aliases for before/after/date/total
ALTER TABLE financial_audit_log ADD COLUMN IF NOT EXISTS total NUMERIC(15,2);
-- 'before'/'after'/'created' map to old_values/new_values, no extra columns needed.

-- security_audit_log: file_size/file_type aliases were added (file_size=size, file_type=type).
-- Provide size/type columns as aliases (same semantic, some code writes these names).
ALTER TABLE security_audit_log ADD COLUMN IF NOT EXISTS size BIGINT;
ALTER TABLE security_audit_log ADD COLUMN IF NOT EXISTS type TEXT;

-- reminders sent_at (some code writes 'sent' boolean)
ALTER TABLE reminder_log ADD COLUMN IF NOT EXISTS sent BOOLEAN DEFAULT false;

-- timesheets short booleans (completed/approved)
ALTER TABLE timesheets ADD COLUMN IF NOT EXISTS completed BOOLEAN DEFAULT false;
ALTER TABLE timesheets ADD COLUMN IF NOT EXISTS approved  BOOLEAN DEFAULT false;

-- inventory_transactions.journal_entry shorthand
ALTER TABLE inventory_transactions ADD COLUMN IF NOT EXISTS journal_entry UUID;
-- Keep journal_entry_id and journal_entry in sync with a trigger-like COALESCE default
-- (no trigger: simple backfill only)
UPDATE inventory_transactions SET journal_entry = journal_entry_id WHERE journal_entry IS NULL;

-- notifications type: 'approval_approved'/'approval_rejected' are allowed by the widened CHECK.
