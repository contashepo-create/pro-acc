-- ============================================================
-- 056 - Cash, bank reconciliation, petty-cash and POS guards
-- ============================================================

BEGIN;

ALTER TABLE cash_transactions ALTER COLUMN tax_rate TYPE NUMERIC(7,4);

-- Audit rows are part of the security boundary: a SECURITY DEFINER writer must
-- never attribute a tenant mutation to an actor from another company.
CREATE OR REPLACE FUNCTION public.guard_audit_actor_tenant()
RETURNS TRIGGER LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
BEGIN
  IF NEW.company_id IS NOT NULL AND NEW.user_id IS NOT NULL AND NOT EXISTS(
    SELECT 1 FROM users WHERE id=NEW.user_id AND company_id=NEW.company_id AND is_active=TRUE
  ) THEN RAISE EXCEPTION 'cross-tenant audit actor'; END IF;
  RETURN NEW;
END;
$$;
DROP TRIGGER IF EXISTS trg_guard_audit_actor_tenant ON audit_log;
CREATE TRIGGER trg_guard_audit_actor_tenant BEFORE INSERT OR UPDATE ON audit_log
FOR EACH ROW EXECUTE FUNCTION guard_audit_actor_tenant();

CREATE OR REPLACE FUNCTION public.guard_cash_bank_tenant_links()
RETURNS TRIGGER LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
BEGIN
  IF TG_OP='UPDATE' AND NEW.company_id IS DISTINCT FROM OLD.company_id
  THEN RAISE EXCEPTION 'Cash/bank tenant cannot change'; END IF;

  IF TG_TABLE_NAME='banks_safes' THEN
    IF NEW.account_id IS NOT NULL AND NOT EXISTS(
      SELECT 1 FROM accounts WHERE id=NEW.account_id AND company_id=NEW.company_id
    ) THEN RAISE EXCEPTION 'cross-tenant bank account'; END IF;
    IF NEW.opening_journal_entry_id IS NOT NULL AND NOT EXISTS(
      SELECT 1 FROM journal_entries WHERE id=NEW.opening_journal_entry_id AND company_id=NEW.company_id
    ) THEN RAISE EXCEPTION 'cross-tenant bank opening journal'; END IF;
    IF TG_OP='UPDATE' AND COALESCE(current_setting('app.business_data_reset',TRUE),'')<>NEW.company_id::TEXT THEN
      IF NEW.type IS DISTINCT FROM OLD.type OR NEW.account_id IS DISTINCT FROM OLD.account_id
        OR NEW.opening_balance IS DISTINCT FROM OLD.opening_balance
        OR (OLD.opening_journal_entry_id IS NOT NULL AND NEW.opening_journal_entry_id IS DISTINCT FROM OLD.opening_journal_entry_id)
      THEN RAISE EXCEPTION 'posted bank accounting fields are immutable'; END IF;
    END IF;
  ELSIF TG_TABLE_NAME='cash_transactions' THEN
    IF NOT EXISTS(SELECT 1 FROM accounts WHERE id=NEW.account_id AND company_id=NEW.company_id)
      OR (NEW.bank_safe_id IS NOT NULL AND NOT EXISTS(
        SELECT 1 FROM banks_safes WHERE id=NEW.bank_safe_id AND company_id=NEW.company_id))
      OR (NEW.contact_id IS NOT NULL AND NOT EXISTS(
        SELECT 1 FROM contacts WHERE id=NEW.contact_id AND company_id=NEW.company_id))
      OR (NEW.project_id IS NOT NULL AND NOT EXISTS(
        SELECT 1 FROM projects WHERE id=NEW.project_id AND company_id=NEW.company_id))
      OR (NEW.category_id IS NOT NULL AND NOT EXISTS(
        SELECT 1 FROM transaction_categories WHERE id=NEW.category_id AND company_id=NEW.company_id))
      OR NOT EXISTS(SELECT 1 FROM users WHERE id=NEW.created_by AND company_id=NEW.company_id AND is_active=TRUE)
      OR (NEW.journal_entry_id IS NOT NULL AND NOT EXISTS(
        SELECT 1 FROM journal_entries WHERE id=NEW.journal_entry_id AND company_id=NEW.company_id))
    THEN RAISE EXCEPTION 'cross-tenant cash transaction link'; END IF;
    IF TG_OP='UPDATE' AND OLD.journal_entry_id IS NOT NULL AND (
      NEW.date IS DISTINCT FROM OLD.date OR NEW.type IS DISTINCT FROM OLD.type OR NEW.amount IS DISTINCT FROM OLD.amount
      OR NEW.account_id IS DISTINCT FROM OLD.account_id OR NEW.bank_safe_id IS DISTINCT FROM OLD.bank_safe_id
      OR NEW.contact_id IS DISTINCT FROM OLD.contact_id OR NEW.project_id IS DISTINCT FROM OLD.project_id
      OR NEW.category_id IS DISTINCT FROM OLD.category_id OR NEW.tax_rate IS DISTINCT FROM OLD.tax_rate
      OR NEW.tax_amount IS DISTINCT FROM OLD.tax_amount OR NEW.journal_entry_id IS DISTINCT FROM OLD.journal_entry_id
      OR NEW.created_by IS DISTINCT FROM OLD.created_by
    ) THEN RAISE EXCEPTION 'posted cash transaction accounting fields are immutable'; END IF;
  ELSIF TG_TABLE_NAME='bank_reconciliation' THEN
    IF NOT EXISTS(SELECT 1 FROM banks_safes WHERE id=NEW.bank_safe_id AND company_id=NEW.company_id)
      OR (NEW.created_by IS NOT NULL AND NOT EXISTS(
        SELECT 1 FROM users WHERE id=NEW.created_by AND company_id=NEW.company_id AND is_active=TRUE))
      OR (NEW.completed_by IS NOT NULL AND NOT EXISTS(
        SELECT 1 FROM users WHERE id=NEW.completed_by AND company_id=NEW.company_id AND is_active=TRUE))
    THEN RAISE EXCEPTION 'cross-tenant bank reconciliation link'; END IF;
    IF TG_OP='UPDATE' AND OLD.status='completed' AND to_jsonb(NEW) IS DISTINCT FROM to_jsonb(OLD)
    THEN RAISE EXCEPTION 'completed reconciliation is immutable'; END IF;
  ELSIF TG_TABLE_NAME='bank_reconciliation_items' THEN
    IF NOT EXISTS(SELECT 1 FROM bank_reconciliation WHERE id=NEW.reconciliation_id AND company_id=NEW.company_id)
    THEN RAISE EXCEPTION 'cross-tenant bank reconciliation item'; END IF;
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_guard_bank_safe_links ON banks_safes;
CREATE TRIGGER trg_guard_bank_safe_links BEFORE INSERT OR UPDATE ON banks_safes
FOR EACH ROW EXECUTE FUNCTION guard_cash_bank_tenant_links();
DROP TRIGGER IF EXISTS trg_guard_cash_transaction_links ON cash_transactions;
CREATE TRIGGER trg_guard_cash_transaction_links BEFORE INSERT OR UPDATE ON cash_transactions
FOR EACH ROW EXECUTE FUNCTION guard_cash_bank_tenant_links();
DROP TRIGGER IF EXISTS trg_guard_bank_reconciliation_links ON bank_reconciliation;
CREATE TRIGGER trg_guard_bank_reconciliation_links BEFORE INSERT OR UPDATE ON bank_reconciliation
FOR EACH ROW EXECUTE FUNCTION guard_cash_bank_tenant_links();
DROP TRIGGER IF EXISTS trg_guard_bank_reconciliation_item_links ON bank_reconciliation_items;
CREATE TRIGGER trg_guard_bank_reconciliation_item_links BEFORE INSERT OR UPDATE ON bank_reconciliation_items
FOR EACH ROW EXECUTE FUNCTION guard_cash_bank_tenant_links();

-- post_cash_transaction did not previously emit an audit row. Audit only when
-- its final journal link is installed, so the snapshot includes the full post.
CREATE OR REPLACE FUNCTION public.audit_posted_cash_transaction()
RETURNS TRIGGER LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
BEGIN
  IF OLD.journal_entry_id IS NULL AND NEW.journal_entry_id IS NOT NULL THEN
    INSERT INTO audit_log(company_id,user_id,action,entity_type,entity_id,new_values)
    VALUES(NEW.company_id,NEW.created_by,'post','cash_transaction',NEW.id,to_jsonb(NEW));
  END IF;
  RETURN NEW;
END;
$$;
DROP TRIGGER IF EXISTS trg_audit_posted_cash_transaction ON cash_transactions;
CREATE TRIGGER trg_audit_posted_cash_transaction AFTER UPDATE ON cash_transactions
FOR EACH ROW EXECUTE FUNCTION audit_posted_cash_transaction();

CREATE OR REPLACE FUNCTION public.guard_petty_pos_tenant_links()
RETURNS TRIGGER LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
BEGIN
  IF TG_OP='UPDATE' AND NEW.company_id IS DISTINCT FROM OLD.company_id
  THEN RAISE EXCEPTION 'Petty cash/POS tenant cannot change'; END IF;

  IF TG_TABLE_NAME='petty_cash_boxes' THEN
    IF NEW.currency !~ '^[A-Z]{3}$' OR LENGTH(COALESCE(NEW.notes,''))>1000
      OR NEW.account_id IS NOT NULL AND NOT EXISTS(
      SELECT 1 FROM accounts WHERE id=NEW.account_id AND company_id=NEW.company_id)
      OR (NEW.custodian_id IS NOT NULL AND NOT EXISTS(
        SELECT 1 FROM employees WHERE id=NEW.custodian_id AND company_id=NEW.company_id))
      OR (NEW.created_by IS NOT NULL AND NOT EXISTS(
        SELECT 1 FROM users WHERE id=NEW.created_by AND company_id=NEW.company_id AND is_active=TRUE))
      OR (NEW.opening_journal_entry_id IS NOT NULL AND NOT EXISTS(
        SELECT 1 FROM journal_entries WHERE id=NEW.opening_journal_entry_id AND company_id=NEW.company_id))
    THEN RAISE EXCEPTION 'cross-tenant petty cash box link'; END IF;
    IF TG_OP='UPDATE' AND (
      NEW.account_id IS DISTINCT FROM OLD.account_id OR NEW.initial_balance IS DISTINCT FROM OLD.initial_balance
      OR NEW.created_by IS DISTINCT FROM OLD.created_by
      OR (OLD.opening_journal_entry_id IS NOT NULL AND NEW.opening_journal_entry_id IS DISTINCT FROM OLD.opening_journal_entry_id)
    ) THEN RAISE EXCEPTION 'posted petty cash box accounting fields are immutable'; END IF;
  ELSIF TG_TABLE_NAME='petty_cash_transactions' THEN
    IF NOT EXISTS(SELECT 1 FROM petty_cash_boxes WHERE id=NEW.box_id AND company_id=NEW.company_id)
      OR (NEW.receipt_url IS NOT NULL AND (LENGTH(NEW.receipt_url)>500
        OR POSITION(NEW.company_id::TEXT||'/' IN NEW.receipt_url)<>1))
      OR LENGTH(COALESCE(NEW.reference_number,''))>200
      OR (NEW.project_id IS NOT NULL AND NOT EXISTS(
        SELECT 1 FROM projects WHERE id=NEW.project_id AND company_id=NEW.company_id))
      OR NOT EXISTS(SELECT 1 FROM users WHERE id=NEW.created_by AND company_id=NEW.company_id AND is_active=TRUE)
      OR (NEW.counterpart_account_id IS NOT NULL AND NOT EXISTS(
        SELECT 1 FROM accounts WHERE id=NEW.counterpart_account_id AND company_id=NEW.company_id))
      OR (NEW.journal_entry_id IS NOT NULL AND NOT EXISTS(
        SELECT 1 FROM journal_entries WHERE id=NEW.journal_entry_id AND company_id=NEW.company_id))
    THEN RAISE EXCEPTION 'cross-tenant petty cash transaction link'; END IF;
    IF TG_OP='UPDATE' AND OLD.journal_entry_id IS NOT NULL AND to_jsonb(NEW) IS DISTINCT FROM to_jsonb(OLD)
    THEN RAISE EXCEPTION 'posted petty cash transaction is immutable'; END IF;
  ELSIF TG_TABLE_NAME='petty_cash_reconciliation' THEN
    IF NOT EXISTS(SELECT 1 FROM petty_cash_boxes WHERE id=NEW.box_id AND company_id=NEW.company_id)
      OR (NEW.reconciled_by IS NOT NULL AND NOT EXISTS(
        SELECT 1 FROM users WHERE id=NEW.reconciled_by AND company_id=NEW.company_id AND is_active=TRUE))
    THEN RAISE EXCEPTION 'cross-tenant petty cash reconciliation link'; END IF;
  ELSIF TG_TABLE_NAME='pos_terminals' THEN
    IF NEW.bank_safe_id IS NOT NULL AND NOT EXISTS(
      SELECT 1 FROM banks_safes WHERE id=NEW.bank_safe_id AND company_id=NEW.company_id)
      OR (NEW.branch_id IS NOT NULL AND NOT EXISTS(
        SELECT 1 FROM branches WHERE id=NEW.branch_id AND company_id=NEW.company_id))
    THEN RAISE EXCEPTION 'cross-tenant POS terminal link'; END IF;
  ELSIF TG_TABLE_NAME='pos_sales' THEN
    IF NEW.terminal_id IS NOT NULL AND NOT EXISTS(
      SELECT 1 FROM pos_terminals WHERE id=NEW.terminal_id AND company_id=NEW.company_id)
      OR (NEW.branch_id IS NOT NULL AND NOT EXISTS(
        SELECT 1 FROM branches WHERE id=NEW.branch_id AND company_id=NEW.company_id))
      OR (NEW.customer_id IS NOT NULL AND NOT EXISTS(
        SELECT 1 FROM contacts WHERE id=NEW.customer_id AND company_id=NEW.company_id))
      OR (NEW.cashier_id IS NOT NULL AND NOT EXISTS(
        SELECT 1 FROM users WHERE id=NEW.cashier_id AND company_id=NEW.company_id AND is_active=TRUE))
      OR (NEW.journal_entry_id IS NOT NULL AND NOT EXISTS(
        SELECT 1 FROM journal_entries WHERE id=NEW.journal_entry_id AND company_id=NEW.company_id))
    THEN RAISE EXCEPTION 'cross-tenant POS sale link'; END IF;
    IF TG_OP='UPDATE' AND OLD.journal_entry_id IS NOT NULL AND (
      NEW.branch_id IS DISTINCT FROM OLD.branch_id OR NEW.terminal_id IS DISTINCT FROM OLD.terminal_id
      OR NEW.number IS DISTINCT FROM OLD.number OR NEW.date IS DISTINCT FROM OLD.date OR NEW.subtotal IS DISTINCT FROM OLD.subtotal
      OR NEW.tax_amount IS DISTINCT FROM OLD.tax_amount OR NEW.discount_amount IS DISTINCT FROM OLD.discount_amount
      OR NEW.total IS DISTINCT FROM OLD.total OR NEW.payment_method IS DISTINCT FROM OLD.payment_method
      OR NEW.customer_id IS DISTINCT FROM OLD.customer_id OR NEW.cashier_id IS DISTINCT FROM OLD.cashier_id
      OR NEW.journal_entry_id IS DISTINCT FROM OLD.journal_entry_id
    ) THEN RAISE EXCEPTION 'posted POS sale accounting fields are immutable'; END IF;
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_guard_petty_cash_box_links ON petty_cash_boxes;
CREATE TRIGGER trg_guard_petty_cash_box_links BEFORE INSERT OR UPDATE ON petty_cash_boxes
FOR EACH ROW EXECUTE FUNCTION guard_petty_pos_tenant_links();
DROP TRIGGER IF EXISTS trg_guard_petty_cash_transaction_links ON petty_cash_transactions;
CREATE TRIGGER trg_guard_petty_cash_transaction_links BEFORE INSERT OR UPDATE ON petty_cash_transactions
FOR EACH ROW EXECUTE FUNCTION guard_petty_pos_tenant_links();
DROP TRIGGER IF EXISTS trg_guard_petty_cash_reconciliation_links ON petty_cash_reconciliation;
CREATE TRIGGER trg_guard_petty_cash_reconciliation_links BEFORE INSERT OR UPDATE ON petty_cash_reconciliation
FOR EACH ROW EXECUTE FUNCTION guard_petty_pos_tenant_links();
DROP TRIGGER IF EXISTS trg_guard_pos_terminal_links ON pos_terminals;
CREATE TRIGGER trg_guard_pos_terminal_links BEFORE INSERT OR UPDATE ON pos_terminals
FOR EACH ROW EXECUTE FUNCTION guard_petty_pos_tenant_links();
DROP TRIGGER IF EXISTS trg_guard_pos_sale_links ON pos_sales;
CREATE TRIGGER trg_guard_pos_sale_links BEFORE INSERT OR UPDATE ON pos_sales
FOR EACH ROW EXECUTE FUNCTION guard_petty_pos_tenant_links();

CREATE OR REPLACE FUNCTION public.get_bank_safe_balances(
  p_company_id UUID,p_bank_safe_ids UUID[] DEFAULT NULL
) RETURNS TABLE(bank_safe_id UUID,current_balance NUMERIC,opening_balance NUMERIC)
LANGUAGE sql SECURITY DEFINER SET search_path=public STABLE AS $$
  SELECT bs.id,
    COALESCE(sum(jl.debit-jl.credit),0)::NUMERIC AS current_balance,
    COALESCE(sum(jl.debit-jl.credit) FILTER(WHERE je.type='opening_balance'),0)::NUMERIC AS opening_balance
  FROM banks_safes bs
  LEFT JOIN journal_lines jl ON jl.company_id=p_company_id AND jl.account_id=bs.account_id
  LEFT JOIN journal_entries je ON je.id=jl.journal_entry_id AND je.company_id=p_company_id
  WHERE bs.company_id=p_company_id AND (p_bank_safe_ids IS NULL OR bs.id=ANY(p_bank_safe_ids))
  GROUP BY bs.id;
$$;

CREATE OR REPLACE FUNCTION public.update_bank_safe_metadata_atomic(
  p_company_id UUID,p_bank_safe_id UUID,p_patch JSONB,p_user_id UUID
) RETURNS JSONB LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
DECLARE v_old banks_safes%ROWTYPE; v_new banks_safes%ROWTYPE; v_name TEXT; v_account_number TEXT;
BEGIN
  IF NOT EXISTS(SELECT 1 FROM users WHERE id=p_user_id AND company_id=p_company_id AND is_active=TRUE)
  THEN RAISE EXCEPTION 'المستخدم غير صالح'; END IF;
  IF p_patch IS NULL OR jsonb_typeof(p_patch)<>'object' OR p_patch='{}'::JSONB OR EXISTS(
    SELECT 1 FROM jsonb_object_keys(p_patch) key WHERE key NOT IN('name','account_number')
  ) THEN RAISE EXCEPTION 'بيانات البنك أو الخزينة غير صالحة'; END IF;
  SELECT * INTO v_old FROM banks_safes WHERE id=p_bank_safe_id AND company_id=p_company_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'البنك أو الخزينة غير موجود'; END IF;
  v_name:=CASE WHEN p_patch?'name' THEN BTRIM(p_patch->>'name') ELSE v_old.name END;
  v_account_number:=CASE WHEN p_patch?'account_number' THEN NULLIF(BTRIM(p_patch->>'account_number'),'') ELSE v_old.account_number END;
  IF NULLIF(v_name,'') IS NULL OR LENGTH(v_name)>200 OR LENGTH(COALESCE(v_account_number,''))>100
  THEN RAISE EXCEPTION 'بيانات البنك أو الخزينة غير صالحة'; END IF;
  IF EXISTS(SELECT 1 FROM banks_safes WHERE company_id=p_company_id AND id<>p_bank_safe_id
    AND LOWER(BTRIM(name))=LOWER(v_name)) THEN RAISE EXCEPTION 'اسم البنك أو الخزينة مستخدم مسبقاً'; END IF;
  UPDATE banks_safes SET name=v_name,account_number=v_account_number,updated_at=NOW()
  WHERE id=p_bank_safe_id RETURNING * INTO v_new;
  INSERT INTO audit_log(company_id,user_id,action,entity_type,entity_id,old_values,new_values)
  VALUES(p_company_id,p_user_id,'update','bank_safe',p_bank_safe_id,to_jsonb(v_old),to_jsonb(v_new));
  RETURN to_jsonb(v_new);
END;
$$;

CREATE OR REPLACE FUNCTION public.create_pos_terminal_atomic(
  p_company_id UUID,p_code TEXT,p_name TEXT,p_bank_safe_id UUID,p_branch_id UUID,p_user_id UUID
) RETURNS JSONB LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
DECLARE v_terminal pos_terminals%ROWTYPE;
BEGIN
  IF NOT EXISTS(SELECT 1 FROM users WHERE id=p_user_id AND company_id=p_company_id AND is_active=TRUE)
  THEN RAISE EXCEPTION 'المستخدم غير صالح'; END IF;
  IF NULLIF(BTRIM(p_code),'') IS NULL OR LENGTH(p_code)>100 OR NULLIF(BTRIM(p_name),'') IS NULL OR LENGTH(p_name)>300
  THEN RAISE EXCEPTION 'بيانات طرفية نقطة البيع غير صالحة'; END IF;
  IF NOT EXISTS(SELECT 1 FROM banks_safes WHERE id=p_bank_safe_id AND company_id=p_company_id AND COALESCE(is_active,TRUE))
  THEN RAISE EXCEPTION 'الخزينة غير موجودة'; END IF;
  IF p_branch_id IS NOT NULL AND NOT EXISTS(
    SELECT 1 FROM branches WHERE id=p_branch_id AND company_id=p_company_id AND COALESCE(is_active,TRUE)
  ) THEN RAISE EXCEPTION 'الفرع غير موجود'; END IF;
  PERFORM pg_advisory_xact_lock(hashtextextended('pos-terminal:'||p_company_id::TEXT||':'||LOWER(BTRIM(p_code)),0));
  IF EXISTS(SELECT 1 FROM pos_terminals WHERE company_id=p_company_id AND LOWER(code)=LOWER(BTRIM(p_code)))
  THEN RAISE EXCEPTION 'كود الطرفية مستخدم مسبقاً'; END IF;
  INSERT INTO pos_terminals(company_id,branch_id,code,name,bank_safe_id,is_active)
  VALUES(p_company_id,p_branch_id,BTRIM(p_code),BTRIM(p_name),p_bank_safe_id,TRUE) RETURNING * INTO v_terminal;
  INSERT INTO audit_log(company_id,user_id,action,entity_type,entity_id,new_values)
  VALUES(p_company_id,p_user_id,'create','pos_terminal',v_terminal.id,to_jsonb(v_terminal));
  RETURN to_jsonb(v_terminal);
END;
$$;

-- Custody files are another cash lifecycle.  Keep the v49/v55 implementations
-- as private implementation details and expose marker-setting, actor-checked
-- wrappers so table triggers can reject service-role direct writes.
ALTER FUNCTION public.open_custody_file(UUID,UUID,DATE,NUMERIC,TEXT,UUID,UUID,UUID)
  RENAME TO open_custody_file_v49_internal;
ALTER FUNCTION public.add_custody_funds(UUID,UUID,DATE,NUMERIC,TEXT,UUID,UUID)
  RENAME TO add_custody_funds_v49_internal;
ALTER FUNCTION public.post_custody_expense(UUID,UUID,DATE,NUMERIC,TEXT,UUID,UUID,BOOLEAN,UUID,UUID,UUID)
  RENAME TO post_custody_expense_v49_internal;
ALTER FUNCTION public.settle_custody_file(UUID,UUID,DATE,NUMERIC,UUID,TEXT,UUID)
  RENAME TO settle_custody_file_v49_internal;
ALTER FUNCTION public.cancel_custody_file(UUID,UUID,UUID)
  RENAME TO cancel_custody_file_v49_internal;
ALTER FUNCTION public.create_purchase_invoice_atomic(UUID,UUID,UUID,UUID,UUID,BOOLEAN,DATE,JSONB,NUMERIC,TEXT,UUID)
  RENAME TO create_purchase_invoice_atomic_v55_internal;
ALTER FUNCTION public.cancel_purchase_invoice_atomic(UUID,UUID,TEXT,UUID)
  RENAME TO cancel_purchase_invoice_atomic_v50_internal;

CREATE OR REPLACE FUNCTION public.open_custody_file(
  p_company_id UUID,p_employee_id UUID,p_date DATE,p_amount NUMERIC,p_reason TEXT,
  p_bank_safe_id UUID,p_project_id UUID,p_created_by UUID
) RETURNS JSONB LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
DECLARE v_result JSONB;
BEGIN
  IF NOT EXISTS(SELECT 1 FROM users WHERE id=p_created_by AND company_id=p_company_id AND is_active=TRUE)
  THEN RAISE EXCEPTION 'المستخدم غير صالح'; END IF;
  PERFORM set_config('app.custody_write_company',p_company_id::TEXT,TRUE);
  v_result:=open_custody_file_v49_internal(p_company_id,p_employee_id,p_date,p_amount,p_reason,
    p_bank_safe_id,p_project_id,p_created_by);
  INSERT INTO audit_log(company_id,user_id,action,entity_type,entity_id,new_values)
  VALUES(p_company_id,p_created_by,'open','custody',(v_result->>'id')::UUID,v_result);
  RETURN v_result;
END;
$$;

CREATE OR REPLACE FUNCTION public.add_custody_funds(
  p_company_id UUID,p_custody_id UUID,p_date DATE,p_amount NUMERIC,p_description TEXT,
  p_bank_safe_id UUID,p_created_by UUID
) RETURNS JSONB LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
DECLARE v_result JSONB;
BEGIN
  IF NOT EXISTS(SELECT 1 FROM users WHERE id=p_created_by AND company_id=p_company_id AND is_active=TRUE)
  THEN RAISE EXCEPTION 'المستخدم غير صالح'; END IF;
  PERFORM set_config('app.custody_write_company',p_company_id::TEXT,TRUE);
  v_result:=add_custody_funds_v49_internal(p_company_id,p_custody_id,p_date,p_amount,p_description,
    p_bank_safe_id,p_created_by);
  INSERT INTO audit_log(company_id,user_id,action,entity_type,entity_id,new_values)
  VALUES(p_company_id,p_created_by,'add_funds','custody',p_custody_id,v_result);
  RETURN v_result;
END;
$$;

CREATE OR REPLACE FUNCTION public.post_custody_expense(
  p_company_id UUID,p_custody_id UUID,p_date DATE,p_amount NUMERIC,p_description TEXT,
  p_expense_account_id UUID,p_project_id UUID,p_allow_excess BOOLEAN,p_invoice_id UUID,
  p_purchase_invoice_id UUID,p_created_by UUID
) RETURNS JSONB LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
DECLARE v_result JSONB;
BEGIN
  IF NOT EXISTS(SELECT 1 FROM users WHERE id=p_created_by AND company_id=p_company_id AND is_active=TRUE)
  THEN RAISE EXCEPTION 'المستخدم غير صالح'; END IF;
  PERFORM set_config('app.custody_write_company',p_company_id::TEXT,TRUE);
  v_result:=post_custody_expense_v49_internal(p_company_id,p_custody_id,p_date,p_amount,p_description,
    p_expense_account_id,p_project_id,p_allow_excess,p_invoice_id,p_purchase_invoice_id,p_created_by);
  INSERT INTO audit_log(company_id,user_id,action,entity_type,entity_id,new_values)
  VALUES(p_company_id,p_created_by,'post_expense','custody',p_custody_id,v_result);
  RETURN v_result;
END;
$$;

CREATE OR REPLACE FUNCTION public.settle_custody_file(
  p_company_id UUID,p_custody_id UUID,p_date DATE,p_returned_cash NUMERIC,p_bank_safe_id UUID,
  p_description TEXT,p_created_by UUID
) RETURNS JSONB LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
DECLARE v_result JSONB;
BEGIN
  IF NOT EXISTS(SELECT 1 FROM users WHERE id=p_created_by AND company_id=p_company_id AND is_active=TRUE)
  THEN RAISE EXCEPTION 'المستخدم غير صالح'; END IF;
  PERFORM set_config('app.custody_write_company',p_company_id::TEXT,TRUE);
  v_result:=settle_custody_file_v49_internal(p_company_id,p_custody_id,p_date,p_returned_cash,
    p_bank_safe_id,p_description,p_created_by);
  INSERT INTO audit_log(company_id,user_id,action,entity_type,entity_id,new_values)
  VALUES(p_company_id,p_created_by,'settle','custody',p_custody_id,v_result);
  RETURN v_result;
END;
$$;

CREATE OR REPLACE FUNCTION public.cancel_custody_file(
  p_company_id UUID,p_custody_id UUID,p_created_by UUID
) RETURNS JSONB LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
DECLARE v_result JSONB;
BEGIN
  IF NOT EXISTS(SELECT 1 FROM users WHERE id=p_created_by AND company_id=p_company_id AND is_active=TRUE)
  THEN RAISE EXCEPTION 'المستخدم غير صالح'; END IF;
  PERFORM set_config('app.custody_write_company',p_company_id::TEXT,TRUE);
  v_result:=cancel_custody_file_v49_internal(p_company_id,p_custody_id,p_created_by);
  INSERT INTO audit_log(company_id,user_id,action,entity_type,entity_id,new_values)
  VALUES(p_company_id,p_created_by,'cancel','custody',p_custody_id,v_result);
  RETURN v_result;
END;
$$;

CREATE OR REPLACE FUNCTION public.update_custody_metadata_atomic(
  p_company_id UUID,p_custody_id UUID,p_patch JSONB,p_user_id UUID
) RETURNS JSONB LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
DECLARE v_old custodies%ROWTYPE; v_new custodies%ROWTYPE; v_project_id UUID;
BEGIN
  IF NOT EXISTS(SELECT 1 FROM users WHERE id=p_user_id AND company_id=p_company_id AND is_active=TRUE)
  THEN RAISE EXCEPTION 'المستخدم غير صالح'; END IF;
  IF p_patch IS NULL OR jsonb_typeof(p_patch)<>'object' OR p_patch='{}'::JSONB OR EXISTS(
    SELECT 1 FROM jsonb_object_keys(p_patch) key WHERE key NOT IN('reason','description','notes','project_id')
  ) THEN RAISE EXCEPTION 'بيانات ملف العهدة غير صالحة'; END IF;
  SELECT * INTO v_old FROM custodies WHERE id=p_custody_id AND company_id=p_company_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'ملف العهدة غير موجود'; END IF;
  IF v_old.status<>'open' OR v_old.deleted_at IS NOT NULL THEN RAISE EXCEPTION 'ملف العهدة مغلق'; END IF;
  IF p_patch?'reason' AND LENGTH(COALESCE(p_patch->>'reason',''))>2000
    OR p_patch?'description' AND LENGTH(COALESCE(p_patch->>'description',''))>2000
    OR p_patch?'notes' AND LENGTH(COALESCE(p_patch->>'notes',''))>2000
  THEN RAISE EXCEPTION 'بيانات ملف العهدة غير صالحة'; END IF;
  IF p_patch?'project_id' AND NULLIF(p_patch->>'project_id','') IS NOT NULL THEN
    BEGIN v_project_id:=(p_patch->>'project_id')::UUID;
    EXCEPTION WHEN invalid_text_representation THEN RAISE EXCEPTION 'معرف المشروع غير صالح'; END;
    IF NOT EXISTS(SELECT 1 FROM projects WHERE id=v_project_id AND company_id=p_company_id)
    THEN RAISE EXCEPTION 'المشروع غير موجود'; END IF;
  ELSE v_project_id:=NULL; END IF;
  PERFORM set_config('app.custody_write_company',p_company_id::TEXT,TRUE);
  UPDATE custodies SET
    reason=CASE WHEN p_patch?'reason' THEN NULLIF(BTRIM(p_patch->>'reason'),'') ELSE reason END,
    description=CASE WHEN p_patch?'description' THEN NULLIF(BTRIM(p_patch->>'description'),'') ELSE description END,
    notes=CASE WHEN p_patch?'notes' THEN NULLIF(BTRIM(p_patch->>'notes'),'') ELSE notes END,
    project_id=CASE WHEN p_patch?'project_id' THEN v_project_id ELSE project_id END,
    updated_at=NOW()
  WHERE id=p_custody_id RETURNING * INTO v_new;
  INSERT INTO audit_log(company_id,user_id,action,entity_type,entity_id,old_values,new_values)
  VALUES(p_company_id,p_user_id,'update','custody',p_custody_id,to_jsonb(v_old),to_jsonb(v_new));
  RETURN to_jsonb(v_new);
END;
$$;

CREATE OR REPLACE FUNCTION public.create_purchase_invoice_atomic(
  p_company_id UUID,p_supplier_id UUID,p_purchase_order_id UUID,p_project_id UUID,
  p_custody_id UUID,p_link_to_project BOOLEAN,p_date DATE,p_items JSONB,
  p_tax_rate NUMERIC,p_notes TEXT,p_user_id UUID
) RETURNS JSONB LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
BEGIN
  IF NOT EXISTS(SELECT 1 FROM users WHERE id=p_user_id AND company_id=p_company_id AND is_active=TRUE)
  THEN RAISE EXCEPTION 'المستخدم غير صالح'; END IF;
  PERFORM set_config('app.custody_write_company',p_company_id::TEXT,TRUE);
  RETURN create_purchase_invoice_atomic_v55_internal(p_company_id,p_supplier_id,p_purchase_order_id,
    p_project_id,p_custody_id,p_link_to_project,p_date,p_items,p_tax_rate,p_notes,p_user_id);
END;
$$;

CREATE OR REPLACE FUNCTION public.cancel_purchase_invoice_atomic(
  p_company_id UUID,p_invoice_id UUID,p_notes TEXT,p_user_id UUID
) RETURNS JSONB LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
BEGIN
  IF NOT EXISTS(SELECT 1 FROM users WHERE id=p_user_id AND company_id=p_company_id AND is_active=TRUE)
  THEN RAISE EXCEPTION 'المستخدم غير صالح'; END IF;
  PERFORM set_config('app.custody_write_company',p_company_id::TEXT,TRUE);
  RETURN cancel_purchase_invoice_atomic_v50_internal(p_company_id,p_invoice_id,p_notes,p_user_id);
END;
$$;

CREATE OR REPLACE FUNCTION public.guard_custody_file_writes()
RETURNS TRIGGER LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
DECLARE v_company UUID:=CASE WHEN TG_OP='DELETE' THEN OLD.company_id ELSE NEW.company_id END;
BEGIN
  IF current_setting('app.business_data_reset',TRUE)=v_company::TEXT THEN
    IF TG_OP='DELETE' THEN RETURN OLD; ELSE RETURN NEW; END IF;
  END IF;
  IF current_setting('app.custody_write_company',TRUE) IS DISTINCT FROM v_company::TEXT
  THEN RAISE EXCEPTION 'custody files are writable only through lifecycle functions'; END IF;
  IF TG_OP='DELETE' THEN RETURN OLD; END IF;
  IF TG_OP='UPDATE' AND NEW.company_id IS DISTINCT FROM OLD.company_id
  THEN RAISE EXCEPTION 'custody tenant cannot change'; END IF;
  IF NOT EXISTS(SELECT 1 FROM employees WHERE id=NEW.employee_id AND company_id=NEW.company_id)
    OR (NEW.project_id IS NOT NULL AND NOT EXISTS(SELECT 1 FROM projects WHERE id=NEW.project_id AND company_id=NEW.company_id))
    OR (NEW.bank_safe_id IS NOT NULL AND NOT EXISTS(SELECT 1 FROM banks_safes WHERE id=NEW.bank_safe_id AND company_id=NEW.company_id))
    OR (NEW.journal_entry_id IS NOT NULL AND NOT EXISTS(SELECT 1 FROM journal_entries WHERE id=NEW.journal_entry_id AND company_id=NEW.company_id))
    OR (NEW.created_by IS NOT NULL AND NOT EXISTS(SELECT 1 FROM users WHERE id=NEW.created_by AND company_id=NEW.company_id))
  THEN RAISE EXCEPTION 'cross-tenant custody link'; END IF;
  IF NEW.amount<0 OR NEW.total_received<0 OR NEW.total_expenses<0 OR NEW.remaining_amount<0
    OR LENGTH(COALESCE(NEW.reason,''))>2000 OR LENGTH(COALESCE(NEW.description,''))>2000
    OR LENGTH(COALESCE(NEW.notes,''))>2000
  THEN RAISE EXCEPTION 'invalid custody values'; END IF;
  RETURN NEW;
END;
$$;

CREATE OR REPLACE FUNCTION public.guard_custody_child_writes()
RETURNS TRIGGER LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
DECLARE v_company UUID:=CASE WHEN TG_OP='DELETE' THEN OLD.company_id ELSE NEW.company_id END;
BEGIN
  IF current_setting('app.business_data_reset',TRUE)=v_company::TEXT THEN
    IF TG_OP='DELETE' THEN RETURN OLD; ELSE RETURN NEW; END IF;
  END IF;
  IF current_setting('app.custody_write_company',TRUE) IS DISTINCT FROM v_company::TEXT
  THEN RAISE EXCEPTION 'custody movements are writable only through lifecycle functions'; END IF;
  IF TG_OP='DELETE' THEN RETURN OLD; END IF;
  IF TG_OP='UPDATE' AND NEW.company_id IS DISTINCT FROM OLD.company_id
  THEN RAISE EXCEPTION 'custody movement tenant cannot change'; END IF;
  IF NOT EXISTS(SELECT 1 FROM custodies WHERE id=NEW.custody_id AND company_id=NEW.company_id)
  THEN RAISE EXCEPTION 'cross-tenant custody movement'; END IF;
  IF TG_TABLE_NAME='custody_transactions' THEN
    IF NEW.amount<=0 OR NEW.amount<>ROUND(NEW.amount,2)
      OR (NEW.created_by IS NOT NULL AND NOT EXISTS(SELECT 1 FROM users WHERE id=NEW.created_by AND company_id=NEW.company_id))
      OR (NEW.journal_entry_id IS NOT NULL AND NOT EXISTS(SELECT 1 FROM journal_entries WHERE id=NEW.journal_entry_id AND company_id=NEW.company_id))
    THEN RAISE EXCEPTION 'invalid custody transaction'; END IF;
  ELSE
    IF NEW.amount<=0 OR NEW.amount<>ROUND(NEW.amount,2)
      OR (NEW.invoice_id IS NOT NULL AND NOT EXISTS(SELECT 1 FROM invoices WHERE id=NEW.invoice_id AND company_id=NEW.company_id))
      OR (NEW.purchase_invoice_id IS NOT NULL AND NOT EXISTS(SELECT 1 FROM purchase_invoices WHERE id=NEW.purchase_invoice_id AND company_id=NEW.company_id))
      OR (NEW.journal_entry_id IS NOT NULL AND NOT EXISTS(SELECT 1 FROM journal_entries WHERE id=NEW.journal_entry_id AND company_id=NEW.company_id))
    THEN RAISE EXCEPTION 'invalid custody invoice'; END IF;
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_guard_custody_file_writes ON custodies;
CREATE TRIGGER trg_guard_custody_file_writes BEFORE INSERT OR UPDATE OR DELETE ON custodies
FOR EACH ROW EXECUTE FUNCTION guard_custody_file_writes();
DROP TRIGGER IF EXISTS trg_guard_custody_transaction_writes ON custody_transactions;
CREATE TRIGGER trg_guard_custody_transaction_writes BEFORE INSERT OR UPDATE OR DELETE ON custody_transactions
FOR EACH ROW EXECUTE FUNCTION guard_custody_child_writes();
DROP TRIGGER IF EXISTS trg_guard_custody_invoice_writes ON custody_invoices;
CREATE TRIGGER trg_guard_custody_invoice_writes BEFORE INSERT OR UPDATE OR DELETE ON custody_invoices
FOR EACH ROW EXECUTE FUNCTION guard_custody_child_writes();

-- Preserve the authenticated hard-reset lifecycle while keeping direct edits
-- to posted bank opening facts blocked everywhere else.
CREATE OR REPLACE FUNCTION public.reset_company_business_data(
  p_company_id UUID, p_user_id UUID, p_code_hash TEXT
) RETURNS JSONB LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
DECLARE
  v_session JSONB; v_attempts INTEGER; v_tables TEXT[]; v_done TEXT[]:='{}';
  v_table TEXT; v_pass INTEGER; v_progress BOOLEAN; v_remaining INTEGER;
  v_preserve TEXT[]:=ARRAY[
    'companies','users','accounts','banks_safes','settings','company_telegram_configs',
    'subscriptions','company_usage_limits','user_permissions','audit_log','security_audit_log',
    'financial_audit_log','financial_audit_trails','company_data_exports','backup_logs',
    'support_tickets','complaints','upgrade_requests','addon_requests','addon_grant_audit',
    'company_messages','company_registration_tokens'
  ];
BEGIN
  IF NOT EXISTS(SELECT 1 FROM users WHERE id=p_user_id AND company_id=p_company_id AND is_active=TRUE)
  THEN RAISE EXCEPTION 'المستخدم غير صالح'; END IF;
  SELECT reset_session_data INTO v_session FROM company_telegram_configs
    WHERE company_id=p_company_id FOR UPDATE;
  IF NOT FOUND OR v_session IS NULL OR v_session->>'step'<>'approved_and_code_sent' THEN
    RETURN jsonb_build_object('status','not_approved');
  END IF;
  IF COALESCE(v_session->>'requester_id','')<>p_user_id::TEXT THEN
    RETURN jsonb_build_object('status','wrong_requester');
  END IF;
  IF NULLIF(v_session->>'expires_at','') IS NULL OR (v_session->>'expires_at')::TIMESTAMPTZ<NOW() THEN
    UPDATE company_telegram_configs SET reset_session_data=NULL WHERE company_id=p_company_id;
    RETURN jsonb_build_object('status','expired');
  END IF;
  v_attempts:=COALESCE((v_session->>'attempts')::INTEGER,0);
  IF p_code_hash IS NULL OR LENGTH(p_code_hash)<>64 OR COALESCE(v_session->>'code_hash','')<>p_code_hash THEN
    v_attempts:=v_attempts+1;
    IF v_attempts>=5 THEN
      UPDATE company_telegram_configs SET reset_session_data=NULL WHERE company_id=p_company_id;
      RETURN jsonb_build_object('status','locked');
    END IF;
    UPDATE company_telegram_configs
      SET reset_session_data=jsonb_set(v_session,'{attempts}',to_jsonb(v_attempts),TRUE)
      WHERE company_id=p_company_id;
    RETURN jsonb_build_object('status','invalid_code','attempts_remaining',5-v_attempts);
  END IF;

  UPDATE company_telegram_configs SET reset_session_data=NULL WHERE company_id=p_company_id;
  PERFORM set_config('app.business_data_reset',p_company_id::TEXT,TRUE);
  UPDATE banks_safes SET opening_balance=0,opening_journal_entry_id=NULL WHERE company_id=p_company_id;
  SELECT array_agg(c.table_name ORDER BY c.table_name) INTO v_tables
  FROM information_schema.columns c
  JOIN information_schema.tables t ON t.table_schema=c.table_schema AND t.table_name=c.table_name
    AND t.table_type='BASE TABLE'
  WHERE c.table_schema='public' AND c.column_name='company_id'
    AND c.table_name<>ALL(v_preserve);

  FOR v_pass IN 1..COALESCE(array_length(v_tables,1),0)+1 LOOP
    v_progress:=FALSE;
    FOREACH v_table IN ARRAY COALESCE(v_tables,'{}') LOOP
      IF v_table=ANY(v_done) THEN CONTINUE; END IF;
      BEGIN
        EXECUTE format('DELETE FROM %I WHERE company_id=$1',v_table) USING p_company_id;
        v_done:=array_append(v_done,v_table); v_progress:=TRUE;
      EXCEPTION WHEN foreign_key_violation THEN NULL;
      END;
    END LOOP;
    EXIT WHEN COALESCE(array_length(v_done,1),0)=COALESCE(array_length(v_tables,1),0);
    EXIT WHEN NOT v_progress;
  END LOOP;
  v_remaining:=COALESCE(array_length(v_tables,1),0)-COALESCE(array_length(v_done,1),0);
  IF v_remaining<>0 THEN RAISE EXCEPTION 'تعذر تصفير بعض الجداول المرتبطة (% جدول)',v_remaining; END IF;
  UPDATE banks_safes SET opening_balance=0 WHERE company_id=p_company_id;
  INSERT INTO security_audit_log(company_id,user_id,action,details)
  VALUES(p_company_id,p_user_id,'company_database_hard_reset_success',jsonb_build_object('date',NOW(),'tables_reset',array_length(v_done,1)));
  RETURN jsonb_build_object('status','reset_success','tables_reset',COALESCE(array_length(v_done,1),0));
END;
$$;

REVOKE ALL ON FUNCTION public.guard_audit_actor_tenant() FROM PUBLIC,anon,authenticated;
REVOKE ALL ON FUNCTION public.guard_cash_bank_tenant_links() FROM PUBLIC,anon,authenticated;
REVOKE ALL ON FUNCTION public.audit_posted_cash_transaction() FROM PUBLIC,anon,authenticated;
REVOKE ALL ON FUNCTION public.guard_petty_pos_tenant_links() FROM PUBLIC,anon,authenticated;
REVOKE ALL ON FUNCTION public.get_bank_safe_balances(UUID,UUID[]) FROM PUBLIC,anon,authenticated;
REVOKE ALL ON FUNCTION public.update_bank_safe_metadata_atomic(UUID,UUID,JSONB,UUID) FROM PUBLIC,anon,authenticated;
REVOKE ALL ON FUNCTION public.create_pos_terminal_atomic(UUID,TEXT,TEXT,UUID,UUID,UUID) FROM PUBLIC,anon,authenticated;
REVOKE ALL ON FUNCTION public.reset_company_business_data(UUID,UUID,TEXT) FROM PUBLIC,anon,authenticated;
REVOKE ALL ON FUNCTION public.guard_custody_file_writes() FROM PUBLIC,anon,authenticated;
REVOKE ALL ON FUNCTION public.guard_custody_child_writes() FROM PUBLIC,anon,authenticated;
REVOKE ALL ON FUNCTION public.open_custody_file(UUID,UUID,DATE,NUMERIC,TEXT,UUID,UUID,UUID) FROM PUBLIC,anon,authenticated;
REVOKE ALL ON FUNCTION public.add_custody_funds(UUID,UUID,DATE,NUMERIC,TEXT,UUID,UUID) FROM PUBLIC,anon,authenticated;
REVOKE ALL ON FUNCTION public.post_custody_expense(UUID,UUID,DATE,NUMERIC,TEXT,UUID,UUID,BOOLEAN,UUID,UUID,UUID) FROM PUBLIC,anon,authenticated;
REVOKE ALL ON FUNCTION public.settle_custody_file(UUID,UUID,DATE,NUMERIC,UUID,TEXT,UUID) FROM PUBLIC,anon,authenticated;
REVOKE ALL ON FUNCTION public.cancel_custody_file(UUID,UUID,UUID) FROM PUBLIC,anon,authenticated;
REVOKE ALL ON FUNCTION public.update_custody_metadata_atomic(UUID,UUID,JSONB,UUID) FROM PUBLIC,anon,authenticated;
REVOKE ALL ON FUNCTION public.create_purchase_invoice_atomic(UUID,UUID,UUID,UUID,UUID,BOOLEAN,DATE,JSONB,NUMERIC,TEXT,UUID) FROM PUBLIC,anon,authenticated;
REVOKE ALL ON FUNCTION public.cancel_purchase_invoice_atomic(UUID,UUID,TEXT,UUID) FROM PUBLIC,anon,authenticated;
REVOKE ALL ON FUNCTION public.open_custody_file_v49_internal(UUID,UUID,DATE,NUMERIC,TEXT,UUID,UUID,UUID) FROM PUBLIC,anon,authenticated,service_role;
REVOKE ALL ON FUNCTION public.add_custody_funds_v49_internal(UUID,UUID,DATE,NUMERIC,TEXT,UUID,UUID) FROM PUBLIC,anon,authenticated,service_role;
REVOKE ALL ON FUNCTION public.post_custody_expense_v49_internal(UUID,UUID,DATE,NUMERIC,TEXT,UUID,UUID,BOOLEAN,UUID,UUID,UUID) FROM PUBLIC,anon,authenticated,service_role;
REVOKE ALL ON FUNCTION public.settle_custody_file_v49_internal(UUID,UUID,DATE,NUMERIC,UUID,TEXT,UUID) FROM PUBLIC,anon,authenticated,service_role;
REVOKE ALL ON FUNCTION public.cancel_custody_file_v49_internal(UUID,UUID,UUID) FROM PUBLIC,anon,authenticated,service_role;
REVOKE ALL ON FUNCTION public.create_purchase_invoice_atomic_v55_internal(UUID,UUID,UUID,UUID,UUID,BOOLEAN,DATE,JSONB,NUMERIC,TEXT,UUID) FROM PUBLIC,anon,authenticated,service_role;
REVOKE ALL ON FUNCTION public.cancel_purchase_invoice_atomic_v50_internal(UUID,UUID,TEXT,UUID) FROM PUBLIC,anon,authenticated,service_role;
GRANT EXECUTE ON FUNCTION public.get_bank_safe_balances(UUID,UUID[]) TO service_role;
GRANT EXECUTE ON FUNCTION public.update_bank_safe_metadata_atomic(UUID,UUID,JSONB,UUID) TO service_role;
GRANT EXECUTE ON FUNCTION public.create_pos_terminal_atomic(UUID,TEXT,TEXT,UUID,UUID,UUID) TO service_role;
GRANT EXECUTE ON FUNCTION public.reset_company_business_data(UUID,UUID,TEXT) TO service_role;
GRANT EXECUTE ON FUNCTION public.open_custody_file(UUID,UUID,DATE,NUMERIC,TEXT,UUID,UUID,UUID) TO service_role;
GRANT EXECUTE ON FUNCTION public.add_custody_funds(UUID,UUID,DATE,NUMERIC,TEXT,UUID,UUID) TO service_role;
GRANT EXECUTE ON FUNCTION public.post_custody_expense(UUID,UUID,DATE,NUMERIC,TEXT,UUID,UUID,BOOLEAN,UUID,UUID,UUID) TO service_role;
GRANT EXECUTE ON FUNCTION public.settle_custody_file(UUID,UUID,DATE,NUMERIC,UUID,TEXT,UUID) TO service_role;
GRANT EXECUTE ON FUNCTION public.cancel_custody_file(UUID,UUID,UUID) TO service_role;
GRANT EXECUTE ON FUNCTION public.update_custody_metadata_atomic(UUID,UUID,JSONB,UUID) TO service_role;
GRANT EXECUTE ON FUNCTION public.create_purchase_invoice_atomic(UUID,UUID,UUID,UUID,UUID,BOOLEAN,DATE,JSONB,NUMERIC,TEXT,UUID) TO service_role;
GRANT EXECUTE ON FUNCTION public.cancel_purchase_invoice_atomic(UUID,UUID,TEXT,UUID) TO service_role;

COMMIT;
