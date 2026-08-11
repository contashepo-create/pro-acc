-- 024: Mark chart-of-accounts group accounts as non-posting headers,
-- and ensure every company has a real cash box linked to account 1110.

ALTER TABLE accounts ADD COLUMN IF NOT EXISTS is_header BOOLEAN DEFAULT false;

UPDATE accounts SET is_header = true
WHERE code IN ('1000','1100','1200','2000','2100','2200','3000','4000','5000','5100','5200');

-- Fix accumulated-depreciation parent (should sit under fixed assets, not the root)
UPDATE accounts child
SET parent_id = parent.id
FROM accounts parent
WHERE child.code = '1290'
  AND parent.code = '1200'
  AND child.company_id = parent.company_id
  AND (child.parent_id IS DISTINCT FROM parent.id);

-- Link the default cash GL account to a real banks_safes row so it appears
-- under البنوك والخزائن (idempotent: skip companies that already have a safe).
INSERT INTO banks_safes (company_id, name, type, account_id, opening_balance, is_active)
SELECT a.company_id, 'الخزينة الرئيسية', 'safe', a.id, 0, true
FROM accounts a
WHERE a.code = '1110'
  AND NOT EXISTS (
    SELECT 1 FROM banks_safes b
    WHERE b.company_id = a.company_id AND b.type = 'safe'
  );
