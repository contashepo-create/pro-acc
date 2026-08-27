-- Migration 018: Tenders, Bonds, CRM, Gantt, Push Notifications, VAT Returns

-- ===== TENDERS (العطاءات والمناقصات) =====
CREATE TABLE IF NOT EXISTS tenders (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id UUID NOT NULL REFERENCES companies(id),
  title TEXT NOT NULL,
  client_name TEXT NOT NULL,
  contact_id UUID,
  reference_number TEXT,
  description TEXT,
  estimated_value NUMERIC(15,2),
  bid_bond_amount NUMERIC(15,2),
  submission_deadline DATE,
  opening_date DATE,
  project_location TEXT,
  project_duration_months INT,
  status TEXT DEFAULT 'draft' CHECK(status IN ('draft', 'preparing', 'submitted', 'won', 'lost', 'cancelled')),
  win_probability INT CHECK(win_probability BETWEEN 0 AND 100),
  project_id UUID REFERENCES projects(id),
  notes TEXT,
  created_by UUID REFERENCES users(id),
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_tenders_company ON tenders(company_id);
CREATE INDEX IF NOT EXISTS idx_tenders_status ON tenders(status);
CREATE INDEX IF NOT EXISTS idx_tenders_deadline ON tenders(submission_deadline);

CREATE TABLE IF NOT EXISTS tender_cost_items (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tender_id UUID NOT NULL REFERENCES tenders(id) ON DELETE CASCADE,
  company_id UUID NOT NULL REFERENCES companies(id),
  category TEXT NOT NULL CHECK(category IN ('materials', 'labor', 'equipment', 'subcontractor', 'overhead', 'other')),
  description TEXT,
  amount NUMERIC(15,2) NOT NULL,
  notes TEXT,
  created_by UUID REFERENCES users(id),
  created_at TIMESTAMPTZ DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_tender_costs_tender ON tender_cost_items(tender_id);

-- ===== BONDS & GUARANTEES (الضمانات والسندات البنكية) =====
CREATE TABLE IF NOT EXISTS bonds (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id UUID NOT NULL REFERENCES companies(id),
  title TEXT NOT NULL,
  type TEXT NOT NULL CHECK(type IN ('bid_bond', 'performance_bond', 'advance_payment', 'retention', 'warranty', 'insurance', 'other')),
  amount NUMERIC(15,2) NOT NULL,
  currency TEXT DEFAULT 'SAR',
  issue_date DATE NOT NULL,
  expiry_date DATE NOT NULL,
  issuing_bank TEXT,
  bank_safe_id UUID REFERENCES banks_safes(id),
  beneficiary_name TEXT,
  project_id UUID REFERENCES projects(id),
  tender_id UUID REFERENCES tenders(id),
  contact_id UUID REFERENCES contacts(id),
  reference_number TEXT,
  status TEXT DEFAULT 'active' CHECK(status IN ('active', 'expired', 'released', 'cancelled')),
  released_at TIMESTAMPTZ,
  notes TEXT,
  created_by UUID REFERENCES users(id),
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_bonds_company ON bonds(company_id);
CREATE INDEX IF NOT EXISTS idx_bonds_type ON bonds(type);
CREATE INDEX IF NOT EXISTS idx_bonds_status ON bonds(status);
CREATE INDEX IF NOT EXISTS idx_bonds_expiry ON bonds(expiry_date);

-- ===== CRM (إدارة العملاء المحتملين) =====
CREATE TABLE IF NOT EXISTS crm_contacts (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id UUID NOT NULL REFERENCES companies(id),
  name TEXT NOT NULL,
  type TEXT NOT NULL CHECK(type IN ('lead', 'opportunity', 'customer')),
  email TEXT,
  phone TEXT,
  company_name TEXT,
  source TEXT DEFAULT 'other' CHECK(source IN ('website', 'referral', 'cold_call', 'tender', 'social', 'other')),
  pipeline_stage TEXT DEFAULT 'new' CHECK(pipeline_stage IN ('new', 'contacted', 'qualified', 'proposal', 'negotiation', 'won', 'lost')),
  estimated_value NUMERIC(15,2),
  description TEXT,
  assigned_to UUID REFERENCES users(id),
  created_by UUID REFERENCES users(id),
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_crm_contacts_company ON crm_contacts(company_id);
CREATE INDEX IF NOT EXISTS idx_crm_contacts_stage ON crm_contacts(pipeline_stage);
CREATE INDEX IF NOT EXISTS idx_crm_contacts_type ON crm_contacts(type);

CREATE TABLE IF NOT EXISTS crm_followups (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  crm_contact_id UUID NOT NULL REFERENCES crm_contacts(id) ON DELETE CASCADE,
  company_id UUID NOT NULL REFERENCES companies(id),
  type TEXT DEFAULT 'call' CHECK(type IN ('call', 'meeting', 'email', 'visit')),
  scheduled_at TIMESTAMPTZ NOT NULL,
  completed_at TIMESTAMPTZ,
  notes TEXT,
  status TEXT DEFAULT 'scheduled' CHECK(status IN ('scheduled', 'completed', 'cancelled')),
  created_by UUID REFERENCES users(id),
  created_at TIMESTAMPTZ DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_crm_followups_contact ON crm_followups(crm_contact_id);
CREATE INDEX IF NOT EXISTS idx_crm_followups_scheduled ON crm_followups(scheduled_at);

-- ===== GANTT CHART — Project Tasks =====
CREATE TABLE IF NOT EXISTS project_tasks (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id UUID NOT NULL REFERENCES companies(id),
  project_id UUID NOT NULL REFERENCES projects(id),
  name TEXT NOT NULL,
  description TEXT,
  start_date DATE NOT NULL,
  end_date DATE NOT NULL,
  progress NUMERIC(5,2) DEFAULT 0 CHECK(progress BETWEEN 0 AND 100),
  status TEXT DEFAULT 'not_started' CHECK(status IN ('not_started', 'in_progress', 'completed', 'blocked', 'on_hold')),
  priority TEXT DEFAULT 'medium' CHECK(priority IN ('low', 'medium', 'high', 'critical')),
  parent_task_id UUID REFERENCES project_tasks(id),
  assigned_to UUID REFERENCES users(id),
  estimated_hours NUMERIC(8,2),
  actual_hours NUMERIC(8,2),
  created_by UUID REFERENCES users(id),
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_project_tasks_project ON project_tasks(project_id);
CREATE INDEX IF NOT EXISTS idx_project_tasks_parent ON project_tasks(parent_task_id);
CREATE INDEX IF NOT EXISTS idx_project_tasks_dates ON project_tasks(start_date, end_date);

-- ===== VAT RETURN FILINGS =====
CREATE TABLE IF NOT EXISTS vat_return_filings (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id UUID NOT NULL REFERENCES companies(id),
  period_from DATE NOT NULL,
  period_to DATE NOT NULL,
  output_vat NUMERIC(15,2) DEFAULT 0,
  input_vat NUMERIC(15,2) DEFAULT 0,
  net_vat NUMERIC(15,2) DEFAULT 0,
  total_sales NUMERIC(15,2) DEFAULT 0,
  total_purchases NUMERIC(15,2) DEFAULT 0,
  status TEXT DEFAULT 'draft' CHECK(status IN ('draft', 'filed', 'paid')),
  filed_at TIMESTAMPTZ,
  filed_by UUID REFERENCES users(id),
  notes TEXT,
  created_by UUID REFERENCES users(id),
  created_at TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE(company_id, period_from, period_to)
);
CREATE INDEX IF NOT EXISTS idx_vat_filings_company ON vat_return_filings(company_id);

-- ===== PUSH NOTIFICATIONS =====
CREATE TABLE IF NOT EXISTS push_subscriptions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES users(id),
  company_id UUID NOT NULL REFERENCES companies(id),
  endpoint TEXT NOT NULL UNIQUE,
  p256dh_key TEXT,
  auth_key TEXT,
  user_agent TEXT,
  is_active BOOLEAN DEFAULT true,
  created_at TIMESTAMPTZ DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_push_subs_user ON push_subscriptions(user_id);

CREATE TABLE IF NOT EXISTS push_notification_log (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id UUID NOT NULL REFERENCES companies(id),
  subscription_id UUID REFERENCES push_subscriptions(id),
  user_id UUID REFERENCES users(id),
  title TEXT NOT NULL,
  body TEXT NOT NULL,
  url TEXT DEFAULT '/dashboard',
  tag TEXT,
  actions TEXT, -- JSON array
  status TEXT DEFAULT 'queued' CHECK(status IN ('queued', 'sent', 'failed')),
  sent_at TIMESTAMPTZ DEFAULT NOW(),
  error TEXT
);
CREATE INDEX IF NOT EXISTS idx_push_log_company ON push_notification_log(company_id);
CREATE INDEX IF NOT EXISTS idx_push_log_sent_at ON push_notification_log(sent_at);

-- ===== Notifications Enhancement =====
-- Add push flag to notifications table
ALTER TABLE notifications ADD COLUMN IF NOT EXISTS push_sent BOOLEAN DEFAULT false;
ALTER TABLE notifications ADD COLUMN IF NOT EXISTS read_at TIMESTAMPTZ;
