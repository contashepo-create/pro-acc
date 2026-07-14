-- FIX: Add global UNIQUE constraint on users.email
-- Prevents duplicate emails across all companies at the database level.
-- This is critical because login searches by email globally (not per-company),
-- and having duplicate emails across companies breaks .single() queries.
--
-- Context: The previous schema had UNIQUE(company_id, email) which allowed
-- the same email in different companies. Since auth/login searches globally
-- by email using .single(), duplicates cause PostgREST errors.

-- Drop the existing unique constraint (company_id, email) and replace with global
DO $$
BEGIN
  -- Drop old constraint if exists
  IF EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'users_company_id_email_key'
  ) THEN
    ALTER TABLE users DROP CONSTRAINT users_company_id_email_key;
  END IF;
EXCEPTION WHEN others THEN NULL;
END $$;

-- Add global unique constraint on email
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'users_email_global_unique'
  ) THEN
    ALTER TABLE users ADD CONSTRAINT users_email_global_unique UNIQUE (email);
  END IF;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

-- Add ZATCA QR code column to invoices for storing generated QR data
ALTER TABLE invoices ADD COLUMN IF NOT EXISTS zatca_qr TEXT;
