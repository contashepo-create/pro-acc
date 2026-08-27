-- Migration 019: Closing Entries, Reversing Entries, Balance Validation, Consolidation

-- Add columns to journal_entries for closing and reversing
ALTER TABLE journal_entries ADD COLUMN IF NOT EXISTS reversed_by UUID REFERENCES journal_entries(id);
ALTER TABLE journal_entries ADD COLUMN IF NOT EXISTS reversal_of UUID REFERENCES journal_entries(id);

-- Add type 'closing' and 'reversing' to journal entry types
DO $$
BEGIN
  -- Check if constraint exists and needs updating
  IF EXISTS (
    SELECT 1 FROM pg_constraint 
    WHERE conname = 'journal_entries_type_check'
  ) THEN
    ALTER TABLE journal_entries DROP CONSTRAINT journal_entries_type_check;
  END IF;
  
  ALTER TABLE journal_entries ADD CONSTRAINT journal_entries_type_check 
    CHECK(type IN ('general', 'opening_balance', 'accrual', 'closing', 'reversing'));
END $$;

-- Add index for faster fiscal year queries
CREATE INDEX IF NOT EXISTS idx_journal_entries_date_type ON journal_entries(company_id, date, type);

-- Add fiscal year status tracking
ALTER TABLE fiscal_years ADD COLUMN IF NOT EXISTS closing_date DATE;
ALTER TABLE fiscal_years ADD COLUMN IF NOT EXISTS closing_entries JSONB DEFAULT '[]'::jsonb;
