-- ربط فاتورة المشتريات بمشروع وبملف عهدة (دفع من العهدة دون ذمة مورد)
ALTER TABLE purchase_invoices ADD COLUMN IF NOT EXISTS project_id UUID;
ALTER TABLE purchase_invoices ADD COLUMN IF NOT EXISTS custody_id UUID;
ALTER TABLE purchase_invoices ADD COLUMN IF NOT EXISTS payment_source TEXT DEFAULT 'ap';

CREATE INDEX IF NOT EXISTS idx_purchase_invoices_project ON purchase_invoices(project_id);
CREATE INDEX IF NOT EXISTS idx_purchase_invoices_custody ON purchase_invoices(custody_id);
