-- ============================================================
-- 095: الأصول الثابتة — قيمة متبقية + استبعاد ببيع (ربح/خسارة)
-- ------------------------------------------------------------
-- الفجوة (2 من التدقيق العالمي): الإهلاك لا يوقف عند قيمة متبقية،
-- والاستبعاد كان يُمنع لأصل له إهلاك (عكس قيد الشراء فقط) بلا
-- بيع ولا ربح/خسارة.
-- الحل (محاذاة IFRS/Odoo/QuickBooks):
--  1) أعمدة: salvage_value/sale_price/sale_date/gain_loss.
--  2) الإهلاك يتوقف عند القيمة المتبقية: القسط الثابت = (التكلفة −
--     المتبقي)/(العمر×12)، والمتناقص لا ينزل تحت المتبقي.
--  3) الإنشاء يقبل القيمة المتبقية (حملة جديدة بأمانة).
--  4) dispose_fixed_asset_atomic: شطب صحيح — عكس المجمع وإثبات
--     الخسارة في 5330 بدل منع الاستبعاد.
--  5) dispose_fixed_asset_sale_atomic: بيع بنقد: تحصيل/مجمع/أصل،
--     والفرق ربح (4200) أو خسارة (5330) بقيد متوازن.
-- ============================================================

ALTER TABLE fixed_assets ADD COLUMN IF NOT EXISTS salvage_value NUMERIC(15,2) NOT NULL DEFAULT 0;
ALTER TABLE fixed_assets ADD COLUMN IF NOT EXISTS sale_price NUMERIC(15,2);
ALTER TABLE fixed_assets ADD COLUMN IF NOT EXISTS sale_date DATE;
ALTER TABLE fixed_assets ADD COLUMN IF NOT EXISTS gain_loss NUMERIC(15,2);

-- حسابا الاستبعاد للشركات القديمة إن غابا
INSERT INTO accounts(company_id, code, name, type, is_active, is_header)
SELECT c.id, '5330', 'مصروف الديون المشكوك في تحصيلها / خسائر الاستبعاد', 'expense', TRUE, FALSE
FROM companies c
WHERE NOT EXISTS (SELECT 1 FROM accounts a WHERE a.company_id = c.id AND a.code = '5330');
INSERT INTO accounts(company_id, code, name, type, is_active, is_header)
SELECT c.id, '4200', 'إيرادات أخرى', 'revenue', TRUE, FALSE
FROM companies c
WHERE NOT EXISTS (SELECT 1 FROM accounts a WHERE a.company_id = c.id AND a.code = '4200');

-- ------------------------------------------------------------
-- 1) دالة الإهلاك الداخلية بحد القيمة المتبقية
-- ------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.depreciate_fixed_asset_v49_internal(
  p_company_id UUID, p_asset_id UUID, p_date DATE, p_expense_account_id UUID, p_user_id UUID
) RETURNS JSONB LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v_asset fixed_assets%ROWTYPE; v_base NUMERIC; v_max NUMERIC; v_amount NUMERIC; v_journal JSONB; v_journal_id UUID;
BEGIN
  SELECT * INTO v_asset FROM fixed_assets WHERE id=p_asset_id AND company_id=p_company_id FOR UPDATE;
  IF NOT FOUND OR v_asset.status<>'active' OR v_asset.purchase_date>p_date THEN RETURN jsonb_build_object('status','skipped'); END IF;
  IF EXISTS(SELECT 1 FROM depreciation_log WHERE company_id=p_company_id AND asset_id=p_asset_id AND date=p_date) THEN
    RETURN jsonb_build_object('status','exists');
  END IF;
  IF v_asset.depreciation_account_id IS NULL OR NOT EXISTS(
    SELECT 1 FROM accounts WHERE id=v_asset.depreciation_account_id AND company_id=p_company_id AND COALESCE(is_header,FALSE)=FALSE
  ) OR NOT EXISTS(
    SELECT 1 FROM accounts WHERE id=p_expense_account_id AND company_id=p_company_id AND COALESCE(is_header,FALSE)=FALSE
  ) THEN RAISE EXCEPTION 'depreciation posting accounts are invalid'; END IF;
  -- الحد الأقصى للإهلاك: التكلفة − المُهلك − القيمة المتبقية
  v_base := v_asset.purchase_cost - COALESCE(v_asset.salvage_value, 0);
  v_max := ROUND(v_asset.purchase_cost - COALESCE(v_asset.accumulated_depreciation,0) - COALESCE(v_asset.salvage_value,0), 2);
  IF v_max <= 0.005 THEN
    UPDATE fixed_assets SET status='fully_depreciated' WHERE id=p_asset_id;
    RETURN jsonb_build_object('status','fully_depreciated');
  END IF;
  IF v_asset.depreciation_method='declining_balance' THEN
    v_amount:=ROUND((v_asset.purchase_cost-COALESCE(v_asset.accumulated_depreciation,0))*((2/NULLIF(v_asset.useful_life_years,0)::NUMERIC)/12),2);
  ELSE
    v_amount:=ROUND(v_base/(NULLIF(v_asset.useful_life_years,0)*12),2);
  END IF;
  v_amount:=ROUND(LEAST(v_amount,v_max),2);
  IF v_amount<=0 THEN RETURN jsonb_build_object('status','skipped'); END IF;
  v_journal:=create_journal_entry(p_company_id,p_date,'general',
    'إهلاك أصل ثابت: '||v_asset.name||' ('||v_asset.code||')',p_user_id,
    jsonb_build_array(
      jsonb_build_object('accountId',p_expense_account_id,'debit',v_amount,'credit',0,'description','إهلاك '||v_asset.code),
      jsonb_build_object('accountId',v_asset.depreciation_account_id,'debit',0,'credit',v_amount,'description','مجمع إهلاك '||v_asset.code)
    ));
  v_journal_id:=(v_journal->>'id')::UUID;
  UPDATE fixed_assets SET accumulated_depreciation=COALESCE(accumulated_depreciation,0)+v_amount,
    net_book_value=v_asset.purchase_cost-(COALESCE(v_asset.accumulated_depreciation,0)+v_amount),
    status=CASE WHEN v_max-v_amount<=0.005 THEN 'fully_depreciated' ELSE status END
  WHERE id=p_asset_id AND company_id=p_company_id;
  INSERT INTO depreciation_log(company_id,asset_id,date,amount,journal_entry_id)
  VALUES(p_company_id,p_asset_id,p_date,v_amount,v_journal_id);
  RETURN jsonb_build_object('status','created','amount',v_amount,'journal_id',v_journal_id);
END;
$$;
REVOKE ALL ON FUNCTION public.depreciate_fixed_asset_v49_internal(UUID,UUID,DATE,UUID,UUID) FROM PUBLIC, anon, authenticated;

-- ------------------------------------------------------------
-- 2) الإنشاء بقيمة متبقية (حملة جديدة — الاسم والهيكل نفسه + بارامتر أخير افتراضي)
-- ------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.create_fixed_asset_v49_internal(
  p_company_id UUID, p_name TEXT, p_code TEXT, p_category TEXT, p_purchase_date DATE,
  p_purchase_cost NUMERIC, p_useful_life_years INTEGER, p_depreciation_method TEXT,
  p_location TEXT, p_notes TEXT, p_bank_safe_id UUID, p_created_by UUID, p_salvage_value NUMERIC DEFAULT 0
) RETURNS JSONB LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
DECLARE
  v_bank_account UUID; v_asset_parent UUID; v_depreciation_parent UUID;
  v_asset_account UUID; v_depreciation_account UUID; v_asset fixed_assets%ROWTYPE;
  v_journal JSONB; v_journal_id UUID; v_rate NUMERIC; v_code TEXT;
BEGIN
  v_code:=UPPER(p_code);
  IF NULLIF(BTRIM(p_name),'') IS NULL OR LENGTH(p_name)>200 OR p_code IS NULL OR p_code!~'^[A-Za-z0-9_-]{1,20}$'
    OR NULLIF(BTRIM(p_category),'') IS NULL OR LENGTH(p_category)>100
    OR p_purchase_cost IS NULL OR p_purchase_cost<=0 OR p_purchase_cost<>ROUND(p_purchase_cost,2)
    OR p_useful_life_years IS NULL OR p_useful_life_years NOT BETWEEN 1 AND 100
    OR p_depreciation_method IS NULL OR p_depreciation_method NOT IN ('straight_line','declining_balance')
    OR p_salvage_value IS NULL OR p_salvage_value<0 OR p_salvage_value<>ROUND(p_salvage_value,2)
    OR p_salvage_value>=p_purchase_cost
    OR LENGTH(COALESCE(p_location,''))>500 OR LENGTH(COALESCE(p_notes,''))>2000 THEN
    RAISE EXCEPTION 'بيانات الأصل غير صالحة';
  END IF;
  SELECT account_id INTO v_bank_account FROM banks_safes
    WHERE id=p_bank_safe_id AND company_id=p_company_id AND COALESCE(is_active,TRUE)=TRUE;
  IF v_bank_account IS NULL THEN RAISE EXCEPTION 'حساب الدفع غير موجود'; END IF;
  SELECT id INTO v_asset_parent FROM accounts WHERE company_id=p_company_id AND code='1230';
  SELECT id INTO v_depreciation_parent FROM accounts WHERE company_id=p_company_id AND code='1290';
  IF v_asset_parent IS NULL OR v_depreciation_parent IS NULL THEN RAISE EXCEPTION 'حسابا الأصل ومجمع الإهلاك الأب غير موجودين'; END IF;
  PERFORM pg_advisory_xact_lock(hashtextextended(p_company_id::TEXT||':fixed-asset:'||v_code,0));
  IF EXISTS(SELECT 1 FROM fixed_assets WHERE company_id=p_company_id AND code=v_code) THEN RAISE EXCEPTION 'كود الأصل مستخدم'; END IF;
  INSERT INTO accounts(company_id,code,name,type,parent_id,is_active,is_header)
  VALUES(p_company_id,'1230-'||v_code,BTRIM(p_name),'asset',v_asset_parent,TRUE,FALSE) RETURNING id INTO v_asset_account;
  INSERT INTO accounts(company_id,code,name,type,parent_id,is_active,is_header)
  VALUES(p_company_id,'1290-'||v_code,'مجمع إهلاك '||BTRIM(p_name),'asset',v_depreciation_parent,TRUE,FALSE) RETURNING id INTO v_depreciation_account;
  v_rate:=ROUND((CASE WHEN p_depreciation_method='declining_balance' THEN 200 ELSE 100 END)/p_useful_life_years::NUMERIC,2);
  INSERT INTO fixed_assets(company_id,name,code,category,purchase_date,purchase_cost,useful_life_years,
    depreciation_rate,depreciation_method,accumulated_depreciation,net_book_value,status,location,notes,
    asset_account_id,depreciation_account_id,salvage_value)
  VALUES(p_company_id,BTRIM(p_name),v_code,BTRIM(p_category),p_purchase_date,p_purchase_cost,p_useful_life_years,
    v_rate,p_depreciation_method,0,p_purchase_cost,'active',NULLIF(BTRIM(p_location),''),NULLIF(BTRIM(p_notes),''),
    v_asset_account,v_depreciation_account,p_salvage_value) RETURNING * INTO v_asset;
  v_journal:=create_journal_entry(p_company_id,p_purchase_date,'general','شراء أصل ثابت: '||BTRIM(p_name),p_created_by,
    jsonb_build_array(
      jsonb_build_object('accountId',v_asset_account,'debit',p_purchase_cost,'credit',0,'description','شراء أصل ثابت'),
      jsonb_build_object('accountId',v_bank_account,'debit',0,'credit',p_purchase_cost,'description','سداد شراء أصل ثابت')));
  v_journal_id:=(v_journal->>'id')::UUID;
  UPDATE journal_entries SET reference_type='fixed_asset',reference_id=v_asset.id WHERE id=v_journal_id AND company_id=p_company_id;
  UPDATE fixed_assets SET journal_entry_id=v_journal_id WHERE id=v_asset.id RETURNING * INTO v_asset;
  RETURN to_jsonb(v_asset);
END;
$$;
REVOKE ALL ON FUNCTION public.create_fixed_asset_v49_internal(UUID,TEXT,TEXT,TEXT,DATE,NUMERIC,INTEGER,TEXT,TEXT,TEXT,UUID,UUID,NUMERIC) FROM PUBLIC, anon, authenticated, service_role;

-- إزالة التوقيع القديم (12 وسيطاً) لمنع الالتباس مع النسخة ذات القيمة المتبقية
DROP FUNCTION IF EXISTS public.create_fixed_asset_v49_internal(UUID,TEXT,TEXT,TEXT,DATE,NUMERIC,INTEGER,TEXT,TEXT,TEXT,UUID,UUID);

-- الغلاف العام يقبل القيمة المتبقية (اختيارية) ويمررها — نفس سلوك 057 (تدقيق + حدود كتابة)
CREATE OR REPLACE FUNCTION public.create_fixed_asset(
  p_company_id UUID,p_name TEXT,p_code TEXT,p_category TEXT,p_purchase_date DATE,
  p_purchase_cost NUMERIC,p_useful_life_years INTEGER,p_depreciation_method TEXT,
  p_location TEXT,p_notes TEXT,p_bank_safe_id UUID,p_created_by UUID,p_salvage_value NUMERIC DEFAULT 0
) RETURNS JSONB LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
DECLARE v_result JSONB;
BEGIN
  IF NOT EXISTS(SELECT 1 FROM users WHERE id=p_created_by AND company_id=p_company_id AND is_active=TRUE)
  THEN RAISE EXCEPTION 'المستخدم غير صالح'; END IF;
  PERFORM set_config('app.asset_write_company',p_company_id::TEXT,TRUE);
  v_result:=create_fixed_asset_v49_internal(p_company_id,p_name,p_code,p_category,p_purchase_date,
    p_purchase_cost,p_useful_life_years,p_depreciation_method,p_location,p_notes,p_bank_safe_id,p_created_by,
    COALESCE(p_salvage_value,0));
  INSERT INTO audit_log(company_id,user_id,action,entity_type,entity_id,new_values)
  VALUES(p_company_id,p_created_by,'create','fixed_asset',(v_result->>'id')::UUID,v_result);
  RETURN v_result;
END;
$$;
DROP FUNCTION IF EXISTS public.create_fixed_asset(UUID,TEXT,TEXT,TEXT,DATE,NUMERIC,INTEGER,TEXT,TEXT,TEXT,UUID,UUID);
REVOKE ALL ON FUNCTION public.create_fixed_asset(UUID,TEXT,TEXT,TEXT,DATE,NUMERIC,INTEGER,TEXT,TEXT,TEXT,UUID,UUID,NUMERIC) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.create_fixed_asset(UUID,TEXT,TEXT,TEXT,DATE,NUMERIC,INTEGER,TEXT,TEXT,TEXT,UUID,UUID,NUMERIC) TO service_role;

-- ------------------------------------------------------------
-- 3) الاستبعاد (شطب): عكس المجمع وإثبات الخسارة بدل منع الاستبعاد
-- ------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.dispose_fixed_asset_atomic(
  p_company_id UUID,p_asset_id UUID,p_user_id UUID
) RETURNS JSONB LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v_old fixed_assets%ROWTYPE; v_new fixed_assets%ROWTYPE;
  v_loss UUID; v_lines JSONB; v_journal JSONB; v_journal_id UUID; v_nbv NUMERIC;
BEGIN
  IF NOT EXISTS(SELECT 1 FROM users WHERE id=p_user_id AND company_id=p_company_id AND is_active=TRUE) THEN
    RAISE EXCEPTION 'المستخدم غير صالح';
  END IF;
  SELECT * INTO v_old FROM fixed_assets WHERE id=p_asset_id AND company_id=p_company_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'الأصل غير موجود'; END IF;
  IF v_old.status='disposed' THEN RETURN jsonb_build_object('id',p_asset_id,'status','disposed','already_processed',TRUE); END IF;
  IF v_old.asset_account_id IS NULL OR v_old.depreciation_account_id IS NULL THEN
    RAISE EXCEPTION 'حسابات الأصل غير مكتملة';
  END IF;
  SELECT id INTO v_loss FROM accounts WHERE company_id=p_company_id AND code='5330'
    AND COALESCE(is_active,TRUE) AND NOT COALESCE(is_header,FALSE);
  IF v_loss IS NULL THEN
    INSERT INTO accounts(company_id,code,name,type,is_active,is_header)
    SELECT p_company_id,'5330','خسائر الاستبعاد وإعدام الأصول','expense',TRUE,FALSE
    WHERE NOT EXISTS(SELECT 1 FROM accounts WHERE company_id=p_company_id AND code='5330');
    SELECT id INTO v_loss FROM accounts WHERE company_id=p_company_id AND code='5330'
      AND COALESCE(is_active,TRUE) AND NOT COALESCE(is_header,FALSE);
  END IF;
  IF v_loss IS NULL THEN RAISE EXCEPTION 'تعذر تهيئة حساب خسائر الاستبعاد (5330)'; END IF;

  v_nbv:=ROUND(v_old.purchase_cost-COALESCE(v_old.accumulated_depreciation,0),2);
  -- قيد الشطب: مجمع مدين + خسارة مدين (بقدر الدفترية) مقابل تكلفة الأصل دائنًا
  v_lines:=jsonb_build_array();
  IF COALESCE(v_old.accumulated_depreciation,0)>0.005 THEN
    v_lines:=v_lines||jsonb_build_array(jsonb_build_object(
      'accountId',v_old.depreciation_account_id,'debit',v_old.accumulated_depreciation,'credit',0,
      'description','عكس مجمع إهلاك '||v_old.code));
  END IF;
  IF v_nbv>0.005 THEN
    v_lines:=v_lines||jsonb_build_array(jsonb_build_object(
      'accountId',v_loss,'debit',v_nbv,'credit',0,'description','خسارة شطب '||v_old.code));
  END IF;
  v_lines:=v_lines||jsonb_build_array(jsonb_build_object(
    'accountId',v_old.asset_account_id,'debit',0,'credit',v_old.purchase_cost,
    'description','شطب أصل ثابت '||v_old.code));
  v_journal:=create_journal_entry(p_company_id,CURRENT_DATE,'general',
    'استبعاد أصل ثابت (شطب): '||v_old.name,p_user_id,v_lines);
  v_journal_id:=(v_journal->>'id')::UUID;
  UPDATE journal_entries SET reference_type='fixed_asset_disposal',reference_id=v_old.id
  WHERE id=v_journal_id AND company_id=p_company_id;

  PERFORM set_config('app.asset_write_company',p_company_id::TEXT,TRUE);
  UPDATE fixed_assets SET status='disposed' WHERE id=p_asset_id RETURNING * INTO v_new;
  INSERT INTO audit_log(company_id,user_id,action,entity_type,entity_id,old_values,new_values)
  VALUES(p_company_id,p_user_id,'dispose','fixed_asset',p_asset_id,to_jsonb(v_old),
    to_jsonb(v_new)||jsonb_build_object('disposal_journal_id',v_journal_id,'method','write_off'));
  RETURN to_jsonb(v_new)||jsonb_build_object('disposal_journal_id',v_journal_id);
END;
$$;
REVOKE ALL ON FUNCTION public.dispose_fixed_asset_atomic(UUID,UUID,UUID) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.dispose_fixed_asset_atomic(UUID,UUID,UUID) TO service_role;

-- ------------------------------------------------------------
-- 4) الاستبعاد ببيع: تحصيل + مجمع مقابل الأصل، والفرق ربح/خسارة
-- ------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.dispose_fixed_asset_sale_atomic(
  p_company_id UUID,p_asset_id UUID,p_sale_price NUMERIC,p_bank_safe_id UUID,p_date DATE,p_user_id UUID
) RETURNS JSONB LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v_old fixed_assets%ROWTYPE; v_new fixed_assets%ROWTYPE;
  v_bank UUID; v_gain UUID; v_loss UUID; v_nbv NUMERIC; v_diff NUMERIC;
  v_lines JSONB; v_journal JSONB; v_journal_id UUID;
BEGIN
  IF NOT EXISTS(SELECT 1 FROM users WHERE id=p_user_id AND company_id=p_company_id AND is_active=TRUE) THEN
    RAISE EXCEPTION 'المستخدم غير صالح';
  END IF;
  IF p_sale_price IS NULL OR p_sale_price<0 OR p_sale_price<>ROUND(p_sale_price,2) OR p_date IS NULL THEN
    RAISE EXCEPTION 'بيانات البيع غير صالحة';
  END IF;
  SELECT * INTO v_old FROM fixed_assets WHERE id=p_asset_id AND company_id=p_company_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'الأصل غير موجود'; END IF;
  IF v_old.status='disposed' THEN RETURN jsonb_build_object('id',p_asset_id,'status','disposed','already_processed',TRUE); END IF;
  IF p_date<v_old.purchase_date THEN RAISE EXCEPTION 'تاريخ البيع قبل تاريخ الشراء'; END IF;
  IF v_old.asset_account_id IS NULL OR v_old.depreciation_account_id IS NULL THEN
    RAISE EXCEPTION 'حسابات الأصل غير مكتملة';
  END IF;
  SELECT account_id INTO v_bank FROM banks_safes
    WHERE id=p_bank_safe_id AND company_id=p_company_id AND COALESCE(is_active,TRUE)=TRUE;
  IF p_sale_price>0 AND v_bank IS NULL THEN RAISE EXCEPTION 'حساب تحصيل البيع غير موجود'; END IF;
  SELECT id INTO v_gain FROM accounts WHERE company_id=p_company_id AND code='4200'
    AND COALESCE(is_active,TRUE) AND NOT COALESCE(is_header,FALSE);
  IF v_gain IS NULL THEN
    INSERT INTO accounts(company_id,code,name,type,is_active,is_header)
    SELECT p_company_id,'4200','إيرادات أخرى','revenue',TRUE,FALSE
    WHERE NOT EXISTS(SELECT 1 FROM accounts WHERE company_id=p_company_id AND code='4200');
    SELECT id INTO v_gain FROM accounts WHERE company_id=p_company_id AND code='4200'
      AND COALESCE(is_active,TRUE) AND NOT COALESCE(is_header,FALSE);
  END IF;
  SELECT id INTO v_loss FROM accounts WHERE company_id=p_company_id AND code='5330'
    AND COALESCE(is_active,TRUE) AND NOT COALESCE(is_header,FALSE);
  IF v_loss IS NULL THEN
    INSERT INTO accounts(company_id,code,name,type,is_active,is_header)
    SELECT p_company_id,'5330','خسائر الاستبعاد وإعدام الأصول','expense',TRUE,FALSE
    WHERE NOT EXISTS(SELECT 1 FROM accounts WHERE company_id=p_company_id AND code='5330');
    SELECT id INTO v_loss FROM accounts WHERE company_id=p_company_id AND code='5330'
      AND COALESCE(is_active,TRUE) AND NOT COALESCE(is_header,FALSE);
  END IF;
  IF v_gain IS NULL OR v_loss IS NULL THEN RAISE EXCEPTION 'تعذر تهيئة حسابات أرباح/خسائر الاستبعاد'; END IF;

  v_nbv:=ROUND(v_old.purchase_cost-COALESCE(v_old.accumulated_depreciation,0),2);
  v_diff:=ROUND(p_sale_price-v_nbv,2);
  -- القيد المتوازن: مدين = التحصيل + المجمع + الخسارة | دائن = التكلفة + الربح
  v_lines:=jsonb_build_array();
  IF p_sale_price>0 THEN
    v_lines:=v_lines||jsonb_build_array(jsonb_build_object(
      'accountId',v_bank,'debit',p_sale_price,'credit',0,'description','تحصيل بيع أصل '||v_old.code));
  END IF;
  IF COALESCE(v_old.accumulated_depreciation,0)>0.005 THEN
    v_lines:=v_lines||jsonb_build_array(jsonb_build_object(
      'accountId',v_old.depreciation_account_id,'debit',v_old.accumulated_depreciation,'credit',0,
      'description','مجمع إهلاك '||v_old.code));
  END IF;
  IF v_diff<0 THEN
    v_lines:=v_lines||jsonb_build_array(jsonb_build_object(
      'accountId',v_loss,'debit',-v_diff,'credit',0,'description','خسارة بيع '||v_old.code));
  END IF;
  v_lines:=v_lines||jsonb_build_array(jsonb_build_object(
    'accountId',v_old.asset_account_id,'debit',0,'credit',v_old.purchase_cost,
    'description','إخراج أصل '||v_old.code));
  IF v_diff>0 THEN
    v_lines:=v_lines||jsonb_build_array(jsonb_build_object(
      'accountId',v_gain,'debit',0,'credit',v_diff,'description','ربح بيع '||v_old.code));
  END IF;
  v_journal:=create_journal_entry(p_company_id,p_date,'general',
    'استبعاد أصل ثابت ببيع: '||v_old.name,p_user_id,v_lines);
  v_journal_id:=(v_journal->>'id')::UUID;
  UPDATE journal_entries SET reference_type='fixed_asset_disposal_sale',reference_id=v_old.id
  WHERE id=v_journal_id AND company_id=p_company_id;

  PERFORM set_config('app.asset_write_company',p_company_id::TEXT,TRUE);
  UPDATE fixed_assets SET status='disposed',
    sale_price=p_sale_price,sale_date=p_date,gain_loss=v_diff
  WHERE id=p_asset_id RETURNING * INTO v_new;
  INSERT INTO audit_log(company_id,user_id,action,entity_type,entity_id,old_values,new_values)
  VALUES(p_company_id,p_user_id,'dispose_sale','fixed_asset',p_asset_id,to_jsonb(v_old),
    to_jsonb(v_new)||jsonb_build_object('disposal_journal_id',v_journal_id,'nbv',v_nbv,'gain_loss',v_diff));
  RETURN to_jsonb(v_new)||jsonb_build_object('disposal_journal_id',v_journal_id,'nbv',v_nbv,'gain_loss',v_diff);
END;
$$;
REVOKE ALL ON FUNCTION public.dispose_fixed_asset_sale_atomic(UUID,UUID,NUMERIC,UUID,DATE,UUID) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.dispose_fixed_asset_sale_atomic(UUID,UUID,NUMERIC,UUID,DATE,UUID) TO service_role;
