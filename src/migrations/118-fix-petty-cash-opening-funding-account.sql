-- 118 - Fix petty-cash opening-balance funding account (3000 → 3100).
-- ------------------------------------------------------------
-- Gap: create_petty_cash_box() funded a positive opening balance from account
-- 3000 (حقوق الملكية), which is a non-posting header. create_journal_entry()
-- rejects header accounts, so creating a petty-cash box with an opening
-- balance failed with a confusing error even though the capital account
-- existed.
--
-- Fix: default the funding account to 3100 (رأس المال) — the posting equity
-- account already used by create_bank_safe() for bank/safe opening balances.
-- ------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.create_petty_cash_box(
 p_company_id UUID,p_name TEXT,p_initial_balance NUMERIC,p_daily_limit NUMERIC,p_currency TEXT,
 p_custodian_id UUID,p_notes TEXT,p_account_id UUID,p_funding_account_id UUID,p_user_id UUID
) RETURNS JSONB LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
DECLARE v_box petty_cash_boxes%ROWTYPE; v_account UUID; v_funding UUID; v_journal JSONB; v_journal_id UUID;
BEGIN
 IF NULLIF(BTRIM(p_name),'') IS NULL OR LENGTH(p_name)>200 OR p_initial_balance<0 OR p_daily_limit<0
   OR p_initial_balance<>ROUND(p_initial_balance,2) OR p_daily_limit<>ROUND(p_daily_limit,2) THEN RAISE EXCEPTION 'بيانات الصندوق غير صالحة'; END IF;
 IF NOT EXISTS(SELECT 1 FROM users WHERE id=p_user_id AND company_id=p_company_id AND is_active=TRUE) THEN RAISE EXCEPTION 'المستخدم غير صالح'; END IF;
 IF p_custodian_id IS NOT NULL AND NOT EXISTS(SELECT 1 FROM employees WHERE id=p_custodian_id AND company_id=p_company_id AND is_active=TRUE) THEN RAISE EXCEPTION 'أمين الصندوق غير صالح'; END IF;
 SELECT id INTO v_account FROM accounts WHERE company_id=p_company_id AND id=COALESCE(p_account_id,
   (SELECT id FROM accounts WHERE company_id=p_company_id AND code='1110' LIMIT 1))
   AND COALESCE(is_active,TRUE)=TRUE AND COALESCE(is_header,FALSE)=FALSE;
 IF v_account IS NULL THEN RAISE EXCEPTION 'حساب الصندوق غير صالح'; END IF;
 IF p_initial_balance>0 THEN
   SELECT id INTO v_funding FROM accounts WHERE company_id=p_company_id AND id=COALESCE(p_funding_account_id,
     (SELECT id FROM accounts WHERE company_id=p_company_id AND code='3100' LIMIT 1))
     AND COALESCE(is_active,TRUE)=TRUE AND COALESCE(is_header,FALSE)=FALSE;
   IF v_funding IS NULL OR v_funding=v_account THEN RAISE EXCEPTION 'حساب تمويل الرصيد الافتتاحي غير صالح'; END IF;
 END IF;
 INSERT INTO petty_cash_boxes(company_id,name,initial_balance,daily_limit,currency,custodian_id,notes,is_active,created_by,account_id)
 VALUES(p_company_id,BTRIM(p_name),p_initial_balance,p_daily_limit,COALESCE(NULLIF(BTRIM(p_currency),''),'SAR'),p_custodian_id,NULLIF(BTRIM(p_notes),''),TRUE,p_user_id,v_account) RETURNING * INTO v_box;
 IF p_initial_balance>0 THEN
   v_journal:=create_journal_entry(p_company_id,CURRENT_DATE,'opening_balance','رصيد افتتاحي لصندوق: '||v_box.name,p_user_id,jsonb_build_array(
    jsonb_build_object('accountId',v_account,'debit',p_initial_balance,'credit',0,'description','رصيد صندوق افتتاحي'),
    jsonb_build_object('accountId',v_funding,'debit',0,'credit',p_initial_balance,'description','مقابل رصيد صندوق افتتاحي')));
   v_journal_id:=(v_journal->>'id')::UUID;
   UPDATE journal_entries SET reference_type='petty_cash_box',reference_id=v_box.id WHERE id=v_journal_id AND company_id=p_company_id;
   UPDATE petty_cash_boxes SET opening_journal_entry_id=v_journal_id WHERE id=v_box.id RETURNING * INTO v_box;
 END IF;
 INSERT INTO audit_log(company_id,user_id,action,entity_type,entity_id,new_values) VALUES(p_company_id,p_user_id,'create','petty_cash_box',v_box.id,to_jsonb(v_box));
 RETURN to_jsonb(v_box);
END;
$$;

REVOKE ALL ON FUNCTION public.create_petty_cash_box(UUID,TEXT,NUMERIC,NUMERIC,TEXT,UUID,TEXT,UUID,UUID,UUID) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.create_petty_cash_box(UUID,TEXT,NUMERIC,NUMERIC,TEXT,UUID,TEXT,UUID,UUID,UUID) TO service_role;

-- ------------------------------------------------------------
-- Also backfill the IAS 21 FX gain/loss accounts (4210/5450) for any company
-- created after migration 097 but before this fix. create_sales_invoice_atomic()
-- and create_voucher_receipt_atomic() require them for foreign-currency
-- postings and raise a hard error when they are missing.
-- ------------------------------------------------------------
INSERT INTO accounts(company_id, code, name, name_en, type, parent_id, is_active, is_header)
SELECT c.id, x.code, x.name, x.name_en, x.acc_type,
  (SELECT a.id FROM accounts a WHERE a.company_id = c.id AND a.code = x.parent_code LIMIT 1),
  TRUE, FALSE
FROM companies c
CROSS JOIN (VALUES
  ('4210', 'أرباح فروق العملة', 'Foreign Exchange Gains', 'revenue', '4000'),
  ('5450', 'خسائر فروق العملة', 'Foreign Exchange Losses', 'expense', '5000')
) AS x(code, name, name_en, acc_type, parent_code)
WHERE NOT EXISTS (
  SELECT 1 FROM accounts a WHERE a.company_id = c.id AND a.code = x.code
);
