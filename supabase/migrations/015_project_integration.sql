-- ============================================================
-- Migration 015: Project Management Integration
-- Date: 2026-07-21
-- Description: Complete project lifecycle - expenses, closure, final payments
-- ============================================================

-- 1. Add closure fields to projects table
ALTER TABLE projects ADD COLUMN IF NOT EXISTS closed_at TIMESTAMP WITH TIME ZONE;
ALTER TABLE projects ADD COLUMN IF NOT EXISTS closed_by UUID REFERENCES users(id);
ALTER TABLE projects ADD COLUMN IF NOT EXISTS closure_journal_entry_id UUID REFERENCES journal_entries(id) ON DELETE SET NULL;

-- 2. Add is_final flag to progress_billing
ALTER TABLE progress_billing ADD COLUMN IF NOT EXISTS is_final BOOLEAN DEFAULT false;

-- Add 'converted' status to quotations
DO $$
BEGIN
  ALTER TABLE quotations DROP CONSTRAINT IF EXISTS quotations_status_check;
  ALTER TABLE quotations ADD CONSTRAINT quotations_status_check
    CHECK(status IN ('draft', 'sent', 'accepted', 'rejected', 'expired', 'converted'));
EXCEPTION WHEN OTHERS THEN
  RAISE NOTICE 'Could not alter quotations status constraint: %', SQLERRM;
END $$;

-- 3. Project Expenses table
CREATE TABLE IF NOT EXISTS project_expenses (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id UUID NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
  project_id UUID NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  expense_type TEXT NOT NULL CHECK(expense_type IN ('materials', 'labor', 'subcontractor', 'equipment', 'other')),
  description TEXT NOT NULL,
  amount NUMERIC NOT NULL DEFAULT 0 CHECK(amount >= 0),
  date DATE NOT NULL,
  contact_id UUID REFERENCES contacts(id) ON DELETE SET NULL,
  account_code TEXT NOT NULL DEFAULT '5100',
  journal_entry_id UUID REFERENCES journal_entries(id) ON DELETE SET NULL,
  notes TEXT,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  created_by UUID REFERENCES users(id)
);

CREATE INDEX IF NOT EXISTS idx_project_expenses_company ON project_expenses(company_id);
CREATE INDEX IF NOT EXISTS idx_project_expenses_project ON project_expenses(project_id);
CREATE INDEX IF NOT EXISTS idx_project_expenses_type ON project_expenses(expense_type);
CREATE INDEX IF NOT EXISTS idx_project_expenses_date ON project_expenses(date DESC);

CREATE TRIGGER IF NOT EXISTS update_project_expenses_updated_at
  BEFORE UPDATE ON project_expenses
  FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

COMMENT ON TABLE project_expenses IS 'مصروفات المشاريع المباشرة';
COMMENT ON COLUMN progress_billing.is_final IS 'تحديد ما إذا كانت الدفعة نهائية';
COMMENT ON COLUMN projects.closed_at IS 'تاريخ إقفال المشروع';
COMMENT ON COLUMN projects.closure_journal_entry_id IS 'قيد إقفال المشروع';
