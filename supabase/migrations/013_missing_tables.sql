-- ============================================================
-- Migration: Missing Tables for Projects and BOQ
-- Date: 2026-07-20
-- Description: Add missing tables for BOQ, progress billing, and quotations
-- ============================================================

-- 1. BOQ Items Table (جدول الكميات)
CREATE TABLE IF NOT EXISTS boq_items (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id UUID NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
  project_id UUID NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  item_code TEXT NOT NULL,
  description TEXT NOT NULL,
  unit TEXT NOT NULL DEFAULT 'وحدة',
  quantity NUMERIC NOT NULL DEFAULT 0,
  unit_price NUMERIC NOT NULL DEFAULT 0,
  total NUMERIC GENERATED ALWAYS AS (quantity * unit_price) STORED,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- Indexes for BOQ items
CREATE INDEX IF NOT EXISTS idx_boq_items_company ON boq_items(company_id);
CREATE INDEX IF NOT EXISTS idx_boq_items_project ON boq_items(project_id);
CREATE INDEX IF NOT EXISTS idx_boq_items_code ON boq_items(item_code);

-- 2. Progress Billing Table (الفواتير المرحلية)
CREATE TABLE IF NOT EXISTS progress_billing (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id UUID NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
  project_id UUID NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  claim_number TEXT NOT NULL,
  date DATE NOT NULL,
  description TEXT,
  gross_amount NUMERIC NOT NULL DEFAULT 0,
  retention_rate NUMERIC DEFAULT 0,
  retention_amount NUMERIC GENERATED ALWAYS AS (gross_amount * retention_rate) STORED,
  net_amount NUMERIC GENERATED ALWAYS AS (gross_amount - (gross_amount * retention_rate)) STORED,
  status TEXT DEFAULT 'approved' CHECK(status IN ('draft', 'approved', 'paid')),
  journal_entry_id UUID REFERENCES journal_entries(id) ON DELETE SET NULL,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  created_by UUID REFERENCES users(id)
);

-- Indexes for progress billing
CREATE INDEX IF NOT EXISTS idx_progress_billing_company ON progress_billing(company_id);
CREATE INDEX IF NOT EXISTS idx_progress_billing_project ON progress_billing(project_id);
CREATE INDEX IF NOT EXISTS idx_progress_billing_date ON progress_billing(date DESC);
CREATE INDEX IF NOT EXISTS idx_progress_billing_status ON progress_billing(status);

-- 3. Quotations Table (عروض الأسعار)
CREATE TABLE IF NOT EXISTS quotations (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id UUID NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
  contact_id UUID REFERENCES contacts(id) ON DELETE SET NULL,
  project_id UUID REFERENCES projects(id) ON DELETE SET NULL,
  number TEXT NOT NULL,
  date DATE NOT NULL,
  valid_until DATE,
  status TEXT DEFAULT 'draft' CHECK(status IN ('draft', 'sent', 'accepted', 'rejected', 'expired')),
  subtotal NUMERIC DEFAULT 0,
  vat_rate NUMERIC DEFAULT 0.15,
  vat_amount NUMERIC DEFAULT 0,
  discount_amount NUMERIC DEFAULT 0,
  total NUMERIC DEFAULT 0,
  notes TEXT,
  terms TEXT,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  created_by UUID REFERENCES users(id)
);

-- Indexes for quotations
CREATE INDEX IF NOT EXISTS idx_quotations_company ON quotations(company_id);
CREATE INDEX IF NOT EXISTS idx_quotations_contact ON quotations(contact_id);
CREATE INDEX IF NOT EXISTS idx_quotations_project ON quotations(project_id);
CREATE INDEX IF NOT EXISTS idx_quotations_number ON quotations(number);
CREATE INDEX IF NOT EXISTS idx_quotations_status ON quotations(status);

-- 4. Quotation Items Table (بنود عروض الأسعار)
CREATE TABLE IF NOT EXISTS quotation_items (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  quotation_id UUID NOT NULL REFERENCES quotations(id) ON DELETE CASCADE,
  description TEXT NOT NULL,
  quantity NUMERIC NOT NULL DEFAULT 0,
  unit_price NUMERIC NOT NULL DEFAULT 0,
  total NUMERIC GENERATED ALWAYS AS (quantity * unit_price) STORED,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- Index for quotation items
CREATE INDEX IF NOT EXISTS idx_quotation_items_quotation ON quotation_items(quotation_id);

-- 5. Updated Timestamp Trigger Function
CREATE OR REPLACE FUNCTION update_updated_at_column()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- Apply the trigger to tables
CREATE TRIGGER update_boq_items_updated_at BEFORE UPDATE ON boq_items
  FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

CREATE TRIGGER update_progress_billing_updated_at BEFORE UPDATE ON progress_billing
  FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

CREATE TRIGGER update_quotations_updated_at BEFORE UPDATE ON quotations
  FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

-- Comments
COMMENT ON TABLE boq_items IS 'جدول بنود الكميات (Bill of Quantities) للمشاريع';
COMMENT ON TABLE progress_billing IS 'جدول الفواتير المرحلية للذمم المستحقة';
COMMENT ON TABLE quotations IS 'جدول عروض الأسعار للعملاء';
COMMENT ON TABLE quotation_items IS 'جدول بنود عروض الأسعار';