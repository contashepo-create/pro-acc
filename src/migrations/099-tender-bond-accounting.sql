-- 099: Tender & Bond Accounting Infrastructure
--
-- Adds the accounting layer for tenders and bonds following Saudi/IFRS standards:
--   1. Suspense account for tender costs (5410)
--   2. Lost tender expense (5420)
--   3. Bid bond margins (1185) and performance bond margins (1186)
--   4. Bank guarantee commission expense (5291)
--   5. tender_expenses table — tracks each individual cost with journal linkage
--   6. New columns on tenders (suspense_account_id, cost_center_id)
--   7. New columns on bonds (margin/commission/journal linkage)

-- ============================================================================
-- 1. New columns on tenders
-- ============================================================================
ALTER TABLE tenders ADD COLUMN IF NOT EXISTS suspense_account_id UUID REFERENCES accounts(id);
ALTER TABLE tenders ADD COLUMN IF NOT EXISTS cost_center_id UUID REFERENCES cost_centers(id);

-- ============================================================================
-- 2. New columns on bonds
-- ============================================================================
ALTER TABLE bonds ADD COLUMN IF NOT EXISTS margin_account_id UUID REFERENCES accounts(id);
ALTER TABLE bonds ADD COLUMN IF NOT EXISTS commission_account_id UUID REFERENCES accounts(id);
ALTER TABLE bonds ADD COLUMN IF NOT EXISTS journal_entry_id UUID REFERENCES journal_entries(id);
ALTER TABLE bonds ADD COLUMN IF NOT EXISTS release_journal_entry_id UUID REFERENCES journal_entries(id);

-- ============================================================================
-- 3. tender_expenses — individual cost tracking with accounting linkage
-- ============================================================================
CREATE TABLE IF NOT EXISTS tender_expenses (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id UUID NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
  tender_id UUID NOT NULL REFERENCES tenders(id) ON DELETE CASCADE,
  expense_type TEXT NOT NULL CHECK(expense_type IN ('karasa','platform_fee','bid_bond_margin','bid_bond_commission','consulting','other')),
  amount NUMERIC(15,2) NOT NULL,
  vat_amount NUMERIC(15,2) NOT NULL DEFAULT 0,
  bank_safe_id UUID REFERENCES banks_safes(id),
  journal_entry_id UUID REFERENCES journal_entries(id),
  voucher_disbursement_id UUID REFERENCES voucher_disbursements(id),
  cost_center_id UUID REFERENCES cost_centers(id),
  description TEXT,
  date DATE NOT NULL DEFAULT CURRENT_DATE,
  created_by UUID REFERENCES users(id),
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_tender_expenses_tender  ON tender_expenses(tender_id);
CREATE INDEX IF NOT EXISTS idx_tender_expenses_company ON tender_expenses(company_id);
CREATE INDEX IF NOT EXISTS idx_tender_expenses_type   ON tender_expenses(expense_type);

-- RLS
ALTER TABLE tender_expenses ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "tender_expenses_service_only" ON tender_expenses;
CREATE POLICY "tender_expenses_service_only" ON tender_expenses
  FOR ALL USING (true) WITH CHECK (true);

-- ============================================================================
-- 4. Seed default accounts for EVERY existing company
--    These accounts are also added to default-accounts.ts for new companies.
-- ============================================================================
DO $$
DECLARE
  comp RECORD;
  v_parent_asset_current UUID;
  v_parent_asset_fixed UUID;
  v_parent_expense_gen UUID;
  v_parent_expense_bank UUID;
  v_parent_expense_direct UUID;
  v_suspense UUID;
  v_lost UUID;
  v_bid_margin UUID;
  v_perf_margin UUID;
  v_bond_comm UUID;
BEGIN
  FOR comp IN SELECT id FROM companies LOOP
    -- Resolve parent IDs
    SELECT id INTO v_parent_asset_current FROM accounts WHERE company_id=comp.id AND code='1100' LIMIT 1;
    SELECT id INTO v_parent_asset_fixed   FROM accounts WHERE company_id=comp.id AND code='1200' LIMIT 1;
    SELECT id INTO v_parent_expense_gen   FROM accounts WHERE company_id=comp.id AND code='5400' LIMIT 1;
    SELECT id INTO v_parent_expense_bank  FROM accounts WHERE company_id=comp.id AND code='5290' LIMIT 1;
    SELECT id INTO v_parent_expense_direct FROM accounts WHERE company_id=comp.id AND code='5100' LIMIT 1;

    -- 1185 خطابات ضمان ابتدائية (Bid Bond Margins) — Asset under current assets
    INSERT INTO accounts (company_id, code, name, name_en, type, parent_id, is_active, is_header)
    VALUES (comp.id, '1185', 'خطابات ضمان ابتدائية', 'Bid Bond Margins', 'asset', v_parent_asset_current, true, false)
    ON CONFLICT (company_id, code) DO NOTHING
    RETURNING id INTO v_bid_margin;
    IF v_bid_margin IS NULL THEN
      SELECT id INTO v_bid_margin FROM accounts WHERE company_id=comp.id AND code='1185' LIMIT 1;
    END IF;

    -- 1186 خطابات ضمان نهائية (Performance Bond Margins)
    INSERT INTO accounts (company_id, code, name, name_en, type, parent_id, is_active, is_header)
    VALUES (comp.id, '1186', 'خطابات ضمان نهائية', 'Performance Bond Margins', 'asset', v_parent_asset_current, true, false)
    ON CONFLICT (company_id, code) DO NOTHING
    RETURNING id INTO v_perf_margin;
    IF v_perf_margin IS NULL THEN
      SELECT id INTO v_perf_margin FROM accounts WHERE company_id=comp.id AND code='1186' LIMIT 1;
    END IF;

    -- 5410 مصاريف مناقصات تحت التسوية (Tender Costs in Suspense) — Expense
    INSERT INTO accounts (company_id, code, name, name_en, type, parent_id, is_active, is_header)
    VALUES (comp.id, '5410', 'مصاريف مناقصات تحت التسوية', 'Tender Costs in Suspense', 'expense', v_parent_expense_direct, true, false)
    ON CONFLICT (company_id, code) DO NOTHING
    RETURNING id INTO v_suspense;
    IF v_suspense IS NULL THEN
      SELECT id INTO v_suspense FROM accounts WHERE company_id=comp.id AND code='5410' LIMIT 1;
    END IF;

    -- 5420 مصاريف مناقصات خاسرة (Lost Tender Costs) — Expense under G&A
    INSERT INTO accounts (company_id, code, name, name_en, type, parent_id, is_active, is_header)
    VALUES (comp.id, '5420', 'مصاريف مناقصات خاسرة', 'Lost Tender Costs', 'expense', v_parent_expense_gen, true, false)
    ON CONFLICT (company_id, code) DO NOTHING
    RETURNING id INTO v_lost;
    IF v_lost IS NULL THEN
      SELECT id INTO v_lost FROM accounts WHERE company_id=comp.id AND code='5420' LIMIT 1;
    END IF;

    -- 5291 عمولات بنكية لضمانات (Bank Guarantee Commissions) — child of 5290
    INSERT INTO accounts (company_id, code, name, name_en, type, parent_id, is_active, is_header)
    VALUES (comp.id, '5291', 'عمولات بنكية لضمانات', 'Bank Guarantee Commissions', 'expense', v_parent_expense_bank, true, false)
    ON CONFLICT (company_id, code) DO NOTHING
    RETURNING id INTO v_bond_comm;
    IF v_bond_comm IS NULL THEN
      SELECT id INTO v_bond_comm FROM accounts WHERE company_id=comp.id AND code='5291' LIMIT 1;
    END IF;
  END LOOP;
END $$;

-- ============================================================================
-- 5. Indexes for tenders
-- ============================================================================
CREATE INDEX IF NOT EXISTS idx_tenders_cost_center ON tenders(cost_center_id);
CREATE INDEX IF NOT EXISTS idx_tenders_suspense    ON tenders(suspense_account_id);

-- ============================================================================
-- 6. Indexes for bonds
-- ============================================================================
CREATE INDEX IF NOT EXISTS idx_bonds_journal        ON bonds(journal_entry_id);
CREATE INDEX IF NOT EXISTS idx_bonds_release_journal ON bonds(release_journal_entry_id);
CREATE INDEX IF NOT EXISTS idx_bonds_tender         ON bonds(tender_id);
CREATE INDEX IF NOT EXISTS idx_bonds_project         ON bonds(project_id);

SELECT 'Migration 099 completed — tender/bond accounting infrastructure' as result;
