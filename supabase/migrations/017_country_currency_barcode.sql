-- ============================================================
-- Migration 017: Country, Currency, and Barcode Support
-- Date: 2026-07-23
-- Description: Add country/currency/vat_rate to companies, barcode to items
-- ============================================================

-- 1. Companies: add country, currency, locale, vat_rate columns
ALTER TABLE companies ADD COLUMN IF NOT EXISTS country TEXT DEFAULT 'السعودية';
ALTER TABLE companies ADD COLUMN IF NOT EXISTS country_code TEXT DEFAULT 'SA';
ALTER TABLE companies ADD COLUMN IF NOT EXISTS currency_code TEXT DEFAULT 'SAR';
ALTER TABLE companies ADD COLUMN IF NOT EXISTS locale TEXT DEFAULT 'ar-SA';
ALTER TABLE companies ADD COLUMN IF NOT EXISTS vat_rate NUMERIC DEFAULT 0.15;

-- 2. Invoice items: add barcode column
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_name = 'invoice_items') THEN
    ALTER TABLE invoice_items ADD COLUMN IF NOT EXISTS barcode TEXT;
  END IF;
END $$;

-- 3. Inventory items: add barcode column
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_name = 'inventory_items') THEN
    ALTER TABLE inventory_items ADD COLUMN IF NOT EXISTS barcode TEXT;
  END IF;
END $$;

-- 4. Backfill existing companies with default Saudi settings
UPDATE companies SET country = 'السعودية', country_code = 'SA', currency_code = 'SAR', locale = 'ar-SA', vat_rate = 0.15
WHERE country IS NULL OR country_code IS NULL;

COMMENT ON COLUMN companies.country IS 'دولة الشركة';
COMMENT ON COLUMN companies.country_code IS 'رمز الدولة (ISO 3166-1 alpha-2)';
COMMENT ON COLUMN companies.currency_code IS 'رمز العملة (ISO 4217)';
COMMENT ON COLUMN companies.locale IS 'اللغة والمنطقة (BCP 47)';
COMMENT ON COLUMN companies.vat_rate IS 'نسبة ضريبة القيمة المضافة (0.15 = 15%)';
