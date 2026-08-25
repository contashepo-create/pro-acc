-- fix: cash_transactions.category_id had no foreign key to transaction_categories.
-- The cash route embeds `transaction_categories!category_id(name)`; PostgREST
-- refuses the embed without a discoverable relationship, so every GET on
-- /api/cash failed with a 500 ("حدث خطأ في الخادم").

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint c
    JOIN pg_attribute a ON a.attrelid = c.conrelid AND a.attnum = ANY(c.conkey)
    WHERE c.contype = 'f'
      AND c.conrelid = 'public.cash_transactions'::regclass
      AND c.confrelid = 'public.transaction_categories'::regclass
      AND a.attname = 'category_id'
  ) THEN
    ALTER TABLE public.cash_transactions
      ADD CONSTRAINT cash_transactions_category_fk
      FOREIGN KEY (category_id) REFERENCES public.transaction_categories(id);
  END IF;
END;
$$;
