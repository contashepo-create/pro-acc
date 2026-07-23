-- ============================================================
-- Migration 022: Credit Notes + Project Financial Tracking
-- Date: 2026-07-23
-- Description: Credit notes tables, project_id linking, account 2180
-- ============================================================

-- 1. Credit Notes table (إشعارات دائنة)
CREATE TABLE IF NOT EXISTS credit_notes (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id UUID NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
  number TEXT NOT NULL,
  invoice_id UUID REFERENCES invoices(id) ON DELETE SET NULL,
  project_id UUID REFERENCES projects(id) ON DELETE SET NULL,
  contact_id UUID REFERENCES contacts(id) ON DELETE SET NULL,
  date DATE NOT NULL,
  reason TEXT NOT NULL,
  subtotal NUMERIC(15,2) NOT NULL DEFAULT 0,
  tax_rate NUMERIC(5,2) DEFAULT 0,
  tax_amount NUMERIC(15,2) NOT NULL DEFAULT 0,
  total NUMERIC(15,2) NOT NULL DEFAULT 0,
  status TEXT DEFAULT 'approved' CHECK(status IN ('draft', 'approved', 'cancelled')),
  journal_entry_id UUID REFERENCES journal_entries(id) ON DELETE SET NULL,
  created_by UUID,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE(company_id, number)
);

CREATE INDEX IF NOT EXISTS idx_credit_notes_company ON credit_notes(company_id);
CREATE INDEX IF NOT EXISTS idx_credit_notes_invoice ON credit_notes(invoice_id);
CREATE INDEX IF NOT EXISTS idx_credit_notes_project ON credit_notes(project_id);
CREATE INDEX IF NOT EXISTS idx_credit_notes_contact ON credit_notes(contact_id);
CREATE INDEX IF NOT EXISTS idx_credit_notes_date ON credit_notes(date DESC);

-- 2. Credit Note Items table
CREATE TABLE IF NOT EXISTS credit_note_items (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id UUID NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
  credit_note_id UUID NOT NULL REFERENCES credit_notes(id) ON DELETE CASCADE,
  description TEXT NOT NULL,
  quantity NUMERIC(15,2) NOT NULL DEFAULT 1,
  unit_price NUMERIC(15,2) NOT NULL DEFAULT 0,
  total NUMERIC(15,2) NOT NULL DEFAULT 0,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_credit_note_items_cn ON credit_note_items(credit_note_id);

-- 3. Add project_id to invoices if not exists
ALTER TABLE invoices ADD COLUMN IF NOT EXISTS project_id UUID REFERENCES projects(id) ON DELETE SET NULL;

-- 4. Credit note numbering sequence
CREATE TABLE IF NOT EXISTS credit_note_sequences (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id UUID NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
  year INTEGER NOT NULL,
  last_number INTEGER DEFAULT 0,
  UNIQUE(company_id, year)
);

-- 5. Ensure account 2180 exists (Advances from Customers)
INSERT INTO accounts (company_id, code, name, type, is_active)
SELECT c.id, '2180', 'دفعات مقدمة من العملاء', 'liability', true
FROM companies c
WHERE NOT EXISTS (
  SELECT 1 FROM accounts a WHERE a.company_id = c.id AND a.code = '2180'
);

COMMENT ON TABLE credit_notes IS 'إشعارات دائنة - لتخفيض رصيد العميل';
COMMENT ON COLUMN credit_notes.project_id IS 'المشروع المرتبط بالإشعار';
COMMENT ON COLUMN credit_notes.invoice_id IS 'الفاتورة المرتبطة بالإشعار';
