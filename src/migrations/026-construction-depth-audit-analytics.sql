-- ============================================================
-- 026 — Construction accounting depth, financial audit trail
-- ============================================================

-- ------------------------------------------------------------
-- 1) Change Orders — contract amendments
-- ------------------------------------------------------------
CREATE TABLE IF NOT EXISTS change_orders (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id UUID NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
  project_id UUID NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  number TEXT NOT NULL,
  title TEXT NOT NULL,
  description TEXT,
  status TEXT NOT NULL DEFAULT 'draft'
    CHECK (status IN ('draft', 'submitted', 'approved', 'rejected', 'invoiced')),
  change_amount NUMERIC(15,2) NOT NULL DEFAULT 0,
  base_contract_amount NUMERIC(15,2) NOT NULL DEFAULT 0,
  new_contract_amount NUMERIC(15,2) NOT NULL DEFAULT 0,
  created_by UUID REFERENCES users(id),
  approved_by UUID REFERENCES users(id),
  approved_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_change_orders_company ON change_orders(company_id);
CREATE INDEX IF NOT EXISTS idx_change_orders_project ON change_orders(project_id);

-- ------------------------------------------------------------
-- 2) Retainage — holdback tracking on invoices
-- ------------------------------------------------------------
ALTER TABLE invoices
  ADD COLUMN IF NOT EXISTS retainage_percent NUMERIC(5,4) NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS retainage_amount NUMERIC(15,2) NOT NULL DEFAULT 0;

-- ------------------------------------------------------------
-- 3) Equipment cost tracking + allocation to projects
-- ------------------------------------------------------------
CREATE TABLE IF NOT EXISTS equipment_costs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id UUID NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
  equipment_id UUID REFERENCES fixed_assets(id) ON DELETE SET NULL,
  project_id UUID REFERENCES projects(id) ON DELETE SET NULL,
  date DATE NOT NULL DEFAULT CURRENT_DATE,
  cost_type TEXT NOT NULL DEFAULT 'other'
    CHECK (cost_type IN ('rental', 'fuel', 'maintenance', 'labour', 'depreciation', 'other')),
  amount NUMERIC(15,2) NOT NULL DEFAULT 0,
  usage_hours NUMERIC(10,2) DEFAULT 0,
  notes TEXT,
  created_by UUID REFERENCES users(id),
  created_at TIMESTAMPTZ DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_equipment_costs_company ON equipment_costs(company_id);
CREATE INDEX IF NOT EXISTS idx_equipment_costs_project ON equipment_costs(project_id);

-- ------------------------------------------------------------
-- 4) Financial audit trail (per company)
-- ------------------------------------------------------------
CREATE TABLE IF NOT EXISTS financial_audit_trails (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id UUID NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
  user_id UUID REFERENCES users(id) ON DELETE SET NULL,
  entity_type TEXT NOT NULL,
  entity_id TEXT NOT NULL,
  action TEXT NOT NULL
    CHECK (action IN ('create', 'update', 'delete', 'approve', 'reject')),
  before_data JSONB,
  after_data JSONB,
  summary TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_fin_audit_company_entity ON financial_audit_trails(company_id, entity_type, entity_id);
CREATE INDEX IF NOT EXISTS idx_fin_audit_company_time ON financial_audit_trails(company_id, created_at);
