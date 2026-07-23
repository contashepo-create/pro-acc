-- ============================================================
-- Migration 021: Extended Contacts Data
-- Date: 2026-07-23
-- Description: Add comprehensive client/supplier fields like Daftra
-- ============================================================

-- Add missing columns to contacts table
ALTER TABLE contacts ADD COLUMN IF NOT EXISTS contact_person TEXT;
ALTER TABLE contacts ADD COLUMN IF NOT EXISTS contact_person_phone TEXT;
ALTER TABLE contacts ADD COLUMN IF NOT EXISTS contact_person_email TEXT;
ALTER TABLE contacts ADD COLUMN IF NOT EXISTS city TEXT;
ALTER TABLE contacts ADD COLUMN IF NOT EXISTS region TEXT;
ALTER TABLE contacts ADD COLUMN IF NOT EXISTS country TEXT DEFAULT 'السعودية';
ALTER TABLE contacts ADD COLUMN IF NOT EXISTS postal_code TEXT;
ALTER TABLE contacts ADD COLUMN IF NOT EXISTS website TEXT;
ALTER TABLE contacts ADD COLUMN IF NOT EXISTS iban TEXT;
ALTER TABLE contacts ADD COLUMN IF NOT EXISTS bank_name TEXT;
ALTER TABLE contacts ADD IF NOT EXISTS COLUMN swift_code TEXT;
ALTER TABLE contacts ADD COLUMN IF NOT EXISTS opening_balance NUMERIC(15,2) DEFAULT 0;
ALTER TABLE contacts ADD COLUMN IF NOT EXISTS opening_balance_type TEXT DEFAULT 'debit' CHECK(opening_balance_type IN ('debit', 'credit'));
ALTER TABLE contacts ADD COLUMN IF NOT EXISTS payment_terms TEXT DEFAULT 'immediate';
ALTER TABLE contacts ADD COLUMN IF NOT EXISTS notes TEXT;
ALTER TABLE contacts ADD COLUMN IF NOT EXISTS is_active BOOLEAN DEFAULT true;
ALTER TABLE contacts ADD COLUMN IF NOT EXISTS date_of_birth DATE;
ALTER TABLE contacts ADD COLUMN IF NOT EXISTS gender TEXT CHECK(gender IN ('male', 'female'));
ALTER TABLE contacts ADD COLUMN IF NOT EXISTS national_id TEXT;
ALTER TABLE contacts ADD COLUMN IF NOT EXISTS category TEXT;
ALTER TABLE contacts ADD COLUMN IF NOT EXISTS created_by UUID REFERENCES users(id);

COMMENT ON COLUMN contacts.contact_person IS 'الشخص المسؤول للتواصل';
COMMENT ON COLUMN contacts.contact_person_phone IS 'هاتف الشخص المسؤول';
COMMENT ON COLUMN contacts.contact_person_email IS 'بريد الشخص المسؤول';
COMMENT ON COLUMN contacts.city IS 'المدينة';
COMMENT ON COLUMN contacts.region IS 'المنطقة/المنطقة الإدارية';
COMMENT ON COLUMN contacts.country IS 'الدولة';
COMMENT ON COLUMN contacts.postal_code IS 'الرمز البريدي';
COMMENT ON COLUMN contacts.iban IS 'رقم الآيبان البنكي';
COMMENT ON COLUMN contacts.bank_name IS 'اسم البنك';
COMMENT ON COLUMN contacts.swift_code IS 'رمز السويفت';
COMMENT ON COLUMN contacts.opening_balance IS 'الرصيد الافتتاحي';
COMMENT ON COLUMN contacts.opening_balance_type IS 'نوع الرصيد الافتتاحي (مدين/دائن)';
COMMENT ON COLUMN contacts.payment_terms IS 'شروط الدفع';
COMMENT ON COLUMN contacts.notes IS 'ملاحظات';
COMMENT ON COLUMN contacts.date_of_birth IS 'تاريخ الميلاد';
COMMENT ON COLUMN contacts.gender IS 'الجنس';
COMMENT ON COLUMN contacts.national_id IS 'رقم الهوية';
COMMENT ON COLUMN contacts.category IS 'التصنيف';
