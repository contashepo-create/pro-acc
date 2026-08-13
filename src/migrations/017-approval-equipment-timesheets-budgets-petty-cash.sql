-- Migration 017: Approval Workflow, Equipment, Timesheets, Budgets, Petty Cash

-- ===== APPROVAL WORKFLOW =====
-- Migration 016 already created approval_requests with the telegram-notification
-- shape (transaction_type/transaction_id). To avoid a CREATE TABLE conflict
-- (which caused "column transaction_type does not exist" errors on fresh DBs
-- when 017's CREATE TABLE IF NOT EXISTS shape won due to index collisions),
-- we no longer attempt to redefine the table here; we just ensure the 017
-- columns and indexes exist.
CREATE TABLE IF NOT EXISTS approval_requests (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id UUID NOT NULL REFERENCES companies(id),
  status TEXT DEFAULT 'pending' CHECK(status IN ('pending', 'approved', 'rejected', 'cancelled')),
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- 016 columns (idempotent)
ALTER TABLE approval_requests ADD COLUMN IF NOT EXISTS transaction_type TEXT;
ALTER TABLE approval_requests ADD COLUMN IF NOT EXISTS transaction_id   TEXT;
ALTER TABLE approval_requests ADD COLUMN IF NOT EXISTS amount           NUMERIC(15,2);
ALTER TABLE approval_requests ADD COLUMN IF NOT EXISTS requester_id     UUID REFERENCES users(id);
ALTER TABLE approval_requests ADD COLUMN IF NOT EXISTS approver_chat_id TEXT;
ALTER TABLE approval_requests ADD COLUMN IF NOT EXISTS message          TEXT;
ALTER TABLE approval_requests ADD COLUMN IF NOT EXISTS approved_at      TIMESTAMPTZ;

-- 017 columns (idempotent)
ALTER TABLE approval_requests ADD COLUMN IF NOT EXISTS entity_type       TEXT;
ALTER TABLE approval_requests ADD COLUMN IF NOT EXISTS entity_id         UUID;
ALTER TABLE approval_requests ADD COLUMN IF NOT EXISTS description       TEXT;
ALTER TABLE approval_requests ADD COLUMN IF NOT EXISTS approver_id       UUID REFERENCES users(id);
ALTER TABLE approval_requests ADD COLUMN IF NOT EXISTS approved_by       UUID REFERENCES users(id);
ALTER TABLE approval_requests ADD COLUMN IF NOT EXISTS approval_comments TEXT;
ALTER TABLE approval_requests ADD COLUMN IF NOT EXISTS updated_at        TIMESTAMPTZ DEFAULT NOW();

-- Indexes (safe: use DO blocks for composite ones because IF NOT EXISTS
-- does not detect definition mismatch)
CREATE INDEX IF NOT EXISTS idx_approval_requests_company   ON approval_requests(company_id);
CREATE INDEX IF NOT EXISTS idx_approval_requests_status    ON approval_requests(status);
CREATE INDEX IF NOT EXISTS idx_approval_requests_requester ON approval_requests(requester_id);

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_indexes
     WHERE schemaname = 'public' AND indexname = 'idx_approval_requests_transaction'
  ) THEN
    CREATE INDEX idx_approval_requests_transaction
      ON approval_requests(transaction_type, transaction_id);
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM pg_indexes
     WHERE schemaname = 'public' AND indexname = 'idx_approval_requests_entity'
  ) THEN
    CREATE INDEX idx_approval_requests_entity
      ON approval_requests(entity_type, entity_id);
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM pg_indexes
     WHERE schemaname = 'public' AND indexname = 'idx_approval_requests_approver'
  ) THEN
    CREATE INDEX idx_approval_requests_approver
      ON approval_requests(approver_id);
  END IF;
END $$;

-- Keep the two column shapes in sync for rows written via either API.
UPDATE approval_requests
   SET transaction_type = entity_type,
       transaction_id   = entity_id::TEXT
 WHERE entity_type IS NOT NULL
   AND (transaction_type IS NULL OR transaction_id IS NULL);

-- ===== EQUIPMENT MANAGEMENT =====
CREATE TABLE IF NOT EXISTS equipment (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id UUID NOT NULL REFERENCES companies(id),
  name TEXT NOT NULL,
  type TEXT NOT NULL, -- excavator, crane, mixer, truck, generator, compressor, scaffold, other
  model TEXT,
  manufacturer TEXT,
  year_of_manufacture INT,
  serial_number TEXT,
  plate_number TEXT,
  purchase_date DATE,
  purchase_cost NUMERIC(15,2) DEFAULT 0,
  depreciation_method TEXT DEFAULT 'straight_line' CHECK(depreciation_method IN ('straight_line', 'declining_balance', 'units_of_production')),
  useful_life_years INT DEFAULT 10,
  current_value NUMERIC(15,2),
  hourly_rate NUMERIC(10,2) DEFAULT 0,
  assigned_project_id UUID REFERENCES projects(id),
  assigned_operator_id UUID,
  status TEXT DEFAULT 'available' CHECK(status IN ('available', 'in_use', 'maintenance', 'decommissioned', 'sold')),
  location TEXT,
  notes TEXT,
  last_maintenance_date DATE,
  maintenance_interval_days INT DEFAULT 90,
  next_maintenance_date DATE,
  created_by UUID REFERENCES users(id),
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_equipment_company ON equipment(company_id);
CREATE INDEX IF NOT EXISTS idx_equipment_status ON equipment(status);
CREATE INDEX IF NOT EXISTS idx_equipment_project ON equipment(assigned_project_id);

-- Equipment maintenance log
CREATE TABLE IF NOT EXISTS equipment_maintenance (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  equipment_id UUID NOT NULL REFERENCES equipment(id) ON DELETE CASCADE,
  company_id UUID NOT NULL REFERENCES companies(id),
  maintenance_date DATE NOT NULL,
  type TEXT DEFAULT 'routine' CHECK(type IN ('routine', 'repair', 'inspection', 'overhaul', 'emergency')),
  description TEXT NOT NULL,
  cost NUMERIC(10,2) DEFAULT 0,
  performed_by TEXT,
  next_maintenance_date DATE,
  parts_replaced TEXT, -- JSON array
  created_by UUID REFERENCES users(id),
  created_at TIMESTAMPTZ DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_equipment_maintenance_equip ON equipment_maintenance(equipment_id);
CREATE INDEX IF NOT EXISTS idx_equipment_maintenance_date ON equipment_maintenance(maintenance_date);

-- Equipment usage log (hours per project)
CREATE TABLE IF NOT EXISTS equipment_usage (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  equipment_id UUID NOT NULL REFERENCES equipment(id) ON DELETE CASCADE,
  company_id UUID NOT NULL REFERENCES companies(id),
  date DATE NOT NULL,
  hours NUMERIC(6,2) NOT NULL,
  project_id UUID REFERENCES projects(id),
  operator_id UUID,
  description TEXT,
  hourly_rate NUMERIC(10,2) DEFAULT 0,
  total_cost NUMERIC(10,2) DEFAULT 0,
  created_by UUID REFERENCES users(id),
  created_at TIMESTAMPTZ DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_equipment_usage_equip ON equipment_usage(equipment_id);
CREATE INDEX IF NOT EXISTS idx_equipment_usage_date ON equipment_usage(date);
CREATE INDEX IF NOT EXISTS idx_equipment_usage_project ON equipment_usage(project_id);

-- ===== TIMESHEETS =====
CREATE TABLE IF NOT EXISTS timesheets (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id UUID NOT NULL REFERENCES companies(id),
  employee_id UUID NOT NULL, -- Could reference employees table
  project_id UUID REFERENCES projects(id),
  date DATE NOT NULL,
  check_in TIMESTAMPTZ,
  check_out TIMESTAMPTZ,
  regular_hours NUMERIC(4,1) DEFAULT 0,
  overtime_hours NUMERIC(4,1) DEFAULT 0,
  break_minutes INT DEFAULT 0,
  work_type TEXT DEFAULT 'normal' CHECK(work_type IN ('normal', 'overtime', 'holiday', 'weekend', 'sick', 'leave')),
  hourly_rate NUMERIC(10,2),
  description TEXT,
  status TEXT DEFAULT 'in_progress' CHECK(status IN ('in_progress', 'completed', 'submitted', 'approved', 'rejected')),
  approved_by UUID REFERENCES users(id),
  approved_at TIMESTAMPTZ,
  created_by UUID REFERENCES users(id),
  created_at TIMESTAMPTZ DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_timesheets_company ON timesheets(company_id);
CREATE INDEX IF NOT EXISTS idx_timesheets_employee ON timesheets(employee_id);
CREATE INDEX IF NOT EXISTS idx_timesheets_date ON timesheets(date);
CREATE INDEX IF NOT EXISTS idx_timesheets_project ON timesheets(project_id);
CREATE INDEX IF NOT EXISTS idx_timesheets_status ON timesheets(status);

-- ===== BUDGETS =====
CREATE TABLE IF NOT EXISTS project_budgets (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id UUID NOT NULL REFERENCES companies(id),
  project_id UUID NOT NULL REFERENCES projects(id),
  category TEXT NOT NULL CHECK(category IN ('materials', 'labor', 'equipment', 'subcontractor', 'overhead', 'other')),
  subcategory TEXT,
  amount NUMERIC(15,2) NOT NULL,
  period TEXT DEFAULT 'total' CHECK(period IN ('total', 'monthly', 'quarterly', 'phase')),
  notes TEXT,
  created_by UUID REFERENCES users(id),
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_project_budgets_company ON project_budgets(company_id);
CREATE INDEX IF NOT EXISTS idx_project_budgets_project ON project_budgets(project_id);
CREATE INDEX IF NOT EXISTS idx_project_budgets_category ON project_budgets(category);

-- ===== PETTY CASH =====
CREATE TABLE IF NOT EXISTS petty_cash_boxes (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id UUID NOT NULL REFERENCES companies(id),
  name TEXT NOT NULL,
  initial_balance NUMERIC(15,2) DEFAULT 0,
  daily_limit NUMERIC(15,2) DEFAULT 5000,
  currency TEXT DEFAULT 'SAR',
  custodian_id UUID,
  notes TEXT,
  is_active BOOLEAN DEFAULT true,
  created_by UUID REFERENCES users(id),
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_petty_cash_boxes_company ON petty_cash_boxes(company_id);

CREATE TABLE IF NOT EXISTS petty_cash_transactions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id UUID NOT NULL REFERENCES companies(id),
  box_id UUID NOT NULL REFERENCES petty_cash_boxes(id),
  type TEXT NOT NULL CHECK(type IN ('deposit', 'withdrawal')),
  amount NUMERIC(15,2) NOT NULL,
  reason TEXT NOT NULL,
  category TEXT DEFAULT 'general' CHECK(category IN ('general', 'transport', 'supplies', 'meals', 'maintenance', 'misc')),
  project_id UUID REFERENCES projects(id),
  receipt_url TEXT,
  reference_number TEXT,
  date DATE NOT NULL,
  created_by UUID REFERENCES users(id),
  created_at TIMESTAMPTZ DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_petty_cash_txns_company ON petty_cash_transactions(company_id);
CREATE INDEX IF NOT EXISTS idx_petty_cash_txns_box ON petty_cash_transactions(box_id);
CREATE INDEX IF NOT EXISTS idx_petty_cash_txns_date ON petty_cash_transactions(date);

CREATE TABLE IF NOT EXISTS petty_cash_reconciliation (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id UUID NOT NULL REFERENCES companies(id),
  box_id UUID NOT NULL REFERENCES petty_cash_boxes(id),
  reconciliation_date DATE NOT NULL,
  system_balance NUMERIC(15,2) NOT NULL,
  physical_count NUMERIC(15,2) NOT NULL,
  difference NUMERIC(15,2) NOT NULL,
  status TEXT DEFAULT 'balanced' CHECK(status IN ('balanced', 'discrepancy')),
  notes TEXT,
  reconciled_by UUID REFERENCES users(id),
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- Add approval-related columns to existing tables
ALTER TABLE journal_entries ADD COLUMN IF NOT EXISTS status TEXT DEFAULT 'posted';
ALTER TABLE journal_entries ADD COLUMN IF NOT EXISTS approved_by UUID;
ALTER TABLE journal_entries ADD COLUMN IF NOT EXISTS approved_at TIMESTAMPTZ;

ALTER TABLE voucher_disbursements ADD COLUMN IF NOT EXISTS status TEXT DEFAULT 'pending';
ALTER TABLE voucher_disbursements ADD COLUMN IF NOT EXISTS approved_by UUID;
ALTER TABLE voucher_disbursements ADD COLUMN IF NOT EXISTS approved_at TIMESTAMPTZ;

ALTER TABLE voucher_receipts ADD COLUMN IF NOT EXISTS status TEXT DEFAULT 'pending';
ALTER TABLE voucher_receipts ADD COLUMN IF NOT EXISTS approved_by UUID;
ALTER TABLE voucher_receipts ADD COLUMN IF NOT EXISTS approved_at TIMESTAMPTZ;

ALTER TABLE salary_sheets ADD COLUMN IF NOT EXISTS status TEXT DEFAULT 'draft';
ALTER TABLE salary_sheets ADD COLUMN IF NOT EXISTS approved_by UUID;
ALTER TABLE salary_sheets ADD COLUMN IF NOT EXISTS approved_at TIMESTAMPTZ;
