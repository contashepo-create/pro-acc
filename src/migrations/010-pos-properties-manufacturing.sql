-- Migration 010: POS, Properties, Manufacturing - Makes ERP suitable for ALL industries

-- 1. POS - Points of Sale for Restaurants, Retail
CREATE TABLE IF NOT EXISTS pos_terminals (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id UUID NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
  branch_id UUID REFERENCES branches(id),
  code TEXT NOT NULL,
  name TEXT NOT NULL,
  is_active BOOLEAN DEFAULT true,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE(company_id, code)
);

CREATE TABLE IF NOT EXISTS pos_sales (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id UUID NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
  branch_id UUID REFERENCES branches(id),
  terminal_id UUID REFERENCES pos_terminals(id),
  number INTEGER NOT NULL,
  date DATE NOT NULL DEFAULT CURRENT_DATE,
  time TIME NOT NULL DEFAULT CURRENT_TIME,
  subtotal NUMERIC(15,2) NOT NULL DEFAULT 0,
  tax_amount NUMERIC(15,2) NOT NULL DEFAULT 0,
  discount_amount NUMERIC(15,2) NOT NULL DEFAULT 0,
  total NUMERIC(15,2) NOT NULL DEFAULT 0,
  payment_method TEXT CHECK (payment_method IN ('cash', 'card', 'transfer', 'mixed')),
  status TEXT DEFAULT 'completed' CHECK (status IN ('completed', 'voided', 'refunded')),
  customer_id UUID REFERENCES contacts(id),
  cashier_id UUID REFERENCES users(id),
  journal_entry_id UUID REFERENCES journal_entries(id),
  created_at TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE(company_id, number)
);

CREATE TABLE IF NOT EXISTS pos_sale_items (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id UUID NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
  sale_id UUID NOT NULL REFERENCES pos_sales(id) ON DELETE CASCADE,
  item_id UUID REFERENCES inventory_items(id),
  description TEXT NOT NULL,
  quantity NUMERIC(15,2) NOT NULL DEFAULT 1,
  unit_price NUMERIC(15,2) NOT NULL DEFAULT 0,
  total NUMERIC(15,2) NOT NULL DEFAULT 0,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_pos_sales_company ON pos_sales(company_id);
CREATE INDEX IF NOT EXISTS idx_pos_sales_date ON pos_sales(date DESC);
CREATE INDEX IF NOT EXISTS idx_pos_terminals_company ON pos_terminals(company_id);

-- 2. Properties - Real Estate
CREATE TABLE IF NOT EXISTS properties (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id UUID NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
  branch_id UUID REFERENCES branches(id),
  code TEXT NOT NULL,
  name TEXT NOT NULL,
  type TEXT CHECK (type IN ('apartment', 'villa', 'office', 'shop', 'warehouse', 'land', 'building')),
  status TEXT DEFAULT 'available' CHECK (status IN ('available', 'rented', 'sold', 'maintenance')),
  address TEXT,
  area NUMERIC(10,2),
  bedrooms INT,
  bathrooms INT,
  purchase_price NUMERIC(15,2),
  rental_price NUMERIC(15,2),
  owner_id UUID REFERENCES contacts(id),
  cost_center_id UUID REFERENCES cost_centers(id),
  account_id UUID REFERENCES accounts(id),
  is_active BOOLEAN DEFAULT true,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE(company_id, code)
);

CREATE TABLE IF NOT EXISTS property_leases (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id UUID NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
  property_id UUID NOT NULL REFERENCES properties(id) ON DELETE CASCADE,
  tenant_id UUID NOT NULL REFERENCES contacts(id),
  start_date DATE NOT NULL,
  end_date DATE NOT NULL,
  monthly_rent NUMERIC(15,2) NOT NULL,
  deposit NUMERIC(15,2) DEFAULT 0,
  status TEXT DEFAULT 'active' CHECK (status IN ('active', 'expired', 'cancelled')),
  journal_entry_id UUID REFERENCES journal_entries(id),
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS property_maintenance (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id UUID NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
  property_id UUID NOT NULL REFERENCES properties(id) ON DELETE CASCADE,
  description TEXT NOT NULL,
  cost NUMERIC(15,2) NOT NULL DEFAULT 0,
  date DATE NOT NULL DEFAULT CURRENT_DATE,
  status TEXT DEFAULT 'pending' CHECK (status IN ('pending', 'in_progress', 'completed')),
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_properties_company ON properties(company_id);
CREATE INDEX IF NOT EXISTS idx_properties_type ON properties(type);
CREATE INDEX IF NOT EXISTS idx_property_leases_company ON property_leases(company_id);

-- 3. Manufacturing - BOM and Production Orders
CREATE TABLE IF NOT EXISTS manufacturing_boms (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id UUID NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
  code TEXT NOT NULL,
  product_id UUID NOT NULL REFERENCES inventory_items(id),
  quantity NUMERIC(15,2) NOT NULL DEFAULT 1,
  description TEXT,
  is_active BOOLEAN DEFAULT true,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE(company_id, code)
);

CREATE TABLE IF NOT EXISTS manufacturing_bom_lines (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  bom_id UUID NOT NULL REFERENCES manufacturing_boms(id) ON DELETE CASCADE,
  component_id UUID NOT NULL REFERENCES inventory_items(id),
  quantity NUMERIC(15,2) NOT NULL DEFAULT 1,
  unit_cost NUMERIC(15,2) DEFAULT 0,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS manufacturing_orders (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id UUID NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
  branch_id UUID REFERENCES branches(id),
  bom_id UUID NOT NULL REFERENCES manufacturing_boms(id),
  number INTEGER NOT NULL,
  product_id UUID NOT NULL REFERENCES inventory_items(id),
  quantity_to_produce NUMERIC(15,2) NOT NULL DEFAULT 1,
  quantity_produced NUMERIC(15,2) NOT NULL DEFAULT 0,
  status TEXT DEFAULT 'draft' CHECK (status IN ('draft', 'in_progress', 'completed', 'cancelled')),
  start_date DATE,
  end_date DATE,
  cost_center_id UUID REFERENCES cost_centers(id),
  journal_entry_id UUID REFERENCES journal_entries(id),
  created_by UUID REFERENCES users(id),
  created_at TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE(company_id, number)
);

CREATE TABLE IF NOT EXISTS manufacturing_order_materials (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  order_id UUID NOT NULL REFERENCES manufacturing_orders(id) ON DELETE CASCADE,
  component_id UUID NOT NULL REFERENCES inventory_items(id),
  required_quantity NUMERIC(15,2) NOT NULL DEFAULT 0,
  consumed_quantity NUMERIC(15,2) NOT NULL DEFAULT 0,
  unit_cost NUMERIC(15,2) DEFAULT 0,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_mfg_boms_company ON manufacturing_boms(company_id);
CREATE INDEX IF NOT EXISTS idx_mfg_orders_company ON manufacturing_orders(company_id);
CREATE INDEX IF NOT EXISTS idx_mfg_orders_status ON manufacturing_orders(status);

-- 4. GOSI and Social Insurance
CREATE TABLE IF NOT EXISTS gosi_settings (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id UUID NOT NULL REFERENCES companies(id) ON DELETE CASCADE UNIQUE,
  saudi_rate NUMERIC(5,2) DEFAULT 9.75,
  expat_rate NUMERIC(5,2) DEFAULT 2,
  company_saudi_rate NUMERIC(5,2) DEFAULT 11.75,
  company_expat_rate NUMERIC(5,2) DEFAULT 2,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- 5. Enhance existing tables for global use
ALTER TABLE pos_sales ADD COLUMN IF NOT EXISTS deleted_at TIMESTAMPTZ;
ALTER TABLE properties ADD COLUMN IF NOT EXISTS deleted_at TIMESTAMPTZ;

-- 6. Materialized view for trial balance performance (optional, create as regular view for now)
CREATE OR REPLACE VIEW vw_trial_balance AS
SELECT 
  c.id as company_id,
  a.id as account_id,
  a.code,
  a.name,
  a.type,
  COALESCE(SUM(jl.debit), 0) as total_debit,
  COALESCE(SUM(jl.credit), 0) as total_credit,
  COALESCE(SUM(jl.debit) - SUM(jl.credit), 0) as balance
FROM companies c
CROSS JOIN accounts a
LEFT JOIN journal_entries je ON je.company_id = c.id AND je.deleted_at IS NULL
LEFT JOIN journal_lines jl ON jl.journal_entry_id = je.id AND jl.account_id = a.id
WHERE a.company_id = c.id AND a.is_active = true
GROUP BY c.id, a.id, a.code, a.name, a.type;

SELECT 'Migration 010 completed - POS, Properties, Manufacturing, GOSI - ERP now 100% for all industries' as result;
