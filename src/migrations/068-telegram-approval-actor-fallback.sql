-- 068 - Telegram approval decisions: robust approver resolution.
--
-- Vouchers (and other financial operations) created by an additional
-- (non-admin) user above the approval threshold are answered from the
-- Telegram-bound chat. The decision RPC resolved the approver exclusively
-- through company_telegram_configs.configured_by, which:
--   * did not exist before migration 059, so legacy rows hold NULL,
--   * goes stale when the configuring admin is deactivated or downgraded.
-- In both cases the admin who owns the bound chat received the request, but
-- pressing "موافق ✅" failed with the generic "انتهى الطلب أو لا تملك صلاحية
-- معالجته" error even when answered within seconds.
--
-- Fix in two parts:
--   1. Backfill configured_by from the company's active admin for every
--      enabled configuration whose current value is missing or stale.
--   2. Make the decision RPC resolve the actor from the bound chat itself and
--      fall back to an active admin instead of hard-failing. The bound chat is
--      the authorization factor (only that chat receives the buttons); the
--      resolved admin is recorded for the audit trail.

-- 1) Backfill configured_by for enabled configurations. The communication
--    write guard requires the audited-function GUC, so we set it per tenant.
DO $$
DECLARE
  cfg RECORD;
BEGIN
  FOR cfg IN
    SELECT DISTINCT c.company_id
    FROM company_telegram_configs c
    WHERE c.is_enabled = TRUE
      AND NULLIF(BTRIM(c.chat_id), '') IS NOT NULL
      AND (
        c.configured_by IS NULL
        OR NOT EXISTS (
          SELECT 1
          FROM users u2
          WHERE u2.id = c.configured_by
            AND u2.company_id = c.company_id
            AND u2.is_active = TRUE
            AND u2.role = 'admin'
        )
      )
  LOOP
    PERFORM set_config('app.communication_write_company', cfg.company_id::TEXT, TRUE);
    UPDATE company_telegram_configs c
    SET configured_by = (
          SELECT u.id
          FROM users u
          WHERE u.company_id = cfg.company_id AND u.is_active = TRUE AND u.role = 'admin'
          ORDER BY u.created_at, u.id
          LIMIT 1
        ),
        updated_at = NOW()
    WHERE c.company_id = cfg.company_id;
  END LOOP;
END;
$$;

-- 2) Robust approver resolution in the Telegram decision RPC.
CREATE OR REPLACE FUNCTION public.respond_approval_by_telegram_atomic(
  p_approval_id UUID,p_action TEXT,p_chat_id TEXT,p_comments TEXT DEFAULT ''
) RETURNS JSONB LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
DECLARE
  v_request approval_requests%ROWTYPE;
  v_config company_telegram_configs%ROWTYPE;
  v_actor UUID;
  v_type TEXT;
  v_result JSONB;
BEGIN
  IF p_action NOT IN('approve','reject') OR LENGTH(COALESCE(p_comments,''))>2000 OR NULLIF(p_chat_id,'') IS NULL
  THEN RAISE EXCEPTION 'قرار الاعتماد غير صالح'; END IF;

  SELECT * INTO v_request FROM approval_requests WHERE id=p_approval_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'طلب الاعتماد غير موجود'; END IF;

  SELECT * INTO v_config FROM company_telegram_configs
  WHERE company_id=v_request.company_id AND is_enabled=TRUE AND approvals_enabled=TRUE AND chat_id=p_chat_id
  FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'حساب تيليجرام غير مخول بالاعتماد'; END IF;

  -- The bound chat is the authorization factor (only it receives the buttons).
  -- configured_by can be NULL on legacy rows or stale after an admin change, so
  -- resolve the actor from the bound chat and fall back to an active admin
  -- instead of rejecting a legitimate approval from the bound chat.
  v_actor := v_config.configured_by;
  IF v_actor IS NULL OR NOT EXISTS(
    SELECT 1 FROM users WHERE id=v_actor AND company_id=v_request.company_id AND is_active=TRUE AND role='admin'
  ) THEN
    SELECT id INTO v_actor FROM users
    WHERE company_id=v_request.company_id AND is_active=TRUE AND role='admin'
    ORDER BY created_at, id LIMIT 1;
  END IF;
  IF v_actor IS NULL THEN RAISE EXCEPTION 'لا يوجد مدير نشط لاعتماد الطلب'; END IF;

  v_type:=COALESCE(v_request.entity_type,v_request.transaction_type);
  IF v_type='voucher_disbursement' THEN
    v_result:=respond_voucher_disbursement_approval(v_request.company_id,p_approval_id,p_action,v_actor,p_chat_id,p_comments);
  ELSIF v_type='voucher_receipt' THEN
    v_result:=respond_voucher_receipt_approval(v_request.company_id,p_approval_id,p_action,v_actor,p_chat_id,p_comments);
  ELSE
    v_result:=respond_approval_request_atomic(v_request.company_id,p_approval_id,p_action,v_actor,p_comments)
      ||jsonb_build_object('approver_chat_id',p_chat_id);
    UPDATE approval_requests SET approver_chat_id=p_chat_id WHERE id=p_approval_id;
  END IF;
  RETURN v_result||jsonb_build_object('company_id',v_request.company_id,'requester_id',v_request.requester_id,'entity_type',v_type);
END;
$$;
