-- 117 - Fix "Direct Costs" (5100) being flagged as a non-posting header.
-- ------------------------------------------------------------
-- Gap: migration 024 marked 5100 as a header account, but the atomic
-- inventory/purchase/sales writers post COGS to 5100 directly (debit 5100 /
-- credit 1170) and `create_journal_entry` rejects header accounts. The result
-- was the runtime error "حسابات المخزون (1170) أو التكلفة (5100) غير مكتملة"
-- when creating a sales invoice with inventory items, even though both
-- accounts existed in the chart.
--
-- Fix: 5100 is a posting (leaf) expense account, not a header. Its children
-- (5110..5195) remain valid sub-categories for manual direct-cost tracking.
-- Reports aggregate per-account (flat), so posting to 5100 alongside its
-- children causes no double counting.
-- ------------------------------------------------------------

UPDATE accounts
SET is_header = FALSE
WHERE code IN ('1170', '5100')
  AND is_header IS DISTINCT FROM FALSE;
