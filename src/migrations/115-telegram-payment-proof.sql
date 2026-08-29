-- 115: Payment proofs move to Telegram; upgrade/renewal flow practicality.
--
-- Production decision 2026-08: customers no longer upload receipt images into
-- the platform. The proof screenshot is sent by the customer to the developer
-- on Telegram (out-of-band), and the request itself carries the transfer
-- metadata (method, amount, date, time, notes). Reasons:
--   * one less private-document surface to store, sign and police;
--   * the developer reviews the actual screenshot in the chat where the
--     customer sent it, next to their conversation history;
--   * every request announces itself on the admin bot with the company's
--     permanent subscriber number, so matching screenshot ↔ request is trivial.
--
-- Changes:
--   1. create_upgrade_request_atomic / create_addon_request_atomic no longer
--      accept (or store) a receipt reference. Any non-NULL value is rejected —
--      the receipt channel is Telegram only, so stale clients cannot smuggle
--      uploads back in.
--   2. review_upgrade_request / review_addon_request no longer demand a stored
--      receipt file for approval. The admin confirms payment visually in
--      Telegram; the guard that mattered (full catalogue price + a transfer
--      date + a pending→approved single transition) stays intact.

-- ---------------------------------------------------------------------------
-- 1. Creation RPCs — receipt reference rejected, NULL stored.
-- ---------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.create_addon_request_atomic(
  p_company_id UUID,p_user_id UUID,p_addon_type TEXT,p_quantity INTEGER,p_duration_type TEXT,
  p_payment_method_code TEXT,p_payment_date DATE,p_payment_time TEXT,p_receipt_image_url TEXT,p_notes TEXT
) RETURNS JSONB
LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
DECLARE v_unit NUMERIC(10,2); v_total NUMERIC(10,2); v_request addon_requests%ROWTYPE;
BEGIN
  IF NOT EXISTS(
    SELECT 1 FROM users u JOIN companies c ON c.id=u.company_id
    WHERE u.id=p_user_id AND u.company_id=p_company_id AND u.is_active=TRUE AND c.is_active=TRUE
  ) THEN RAISE EXCEPTION 'invalid tenant actor'; END IF;
  IF p_addon_type IS NULL OR p_addon_type NOT IN('extra_user','extra_branch','storage_gb')
    OR p_quantity IS NULL OR p_quantity NOT BETWEEN 1 AND 100
    OR p_duration_type IS NULL OR p_duration_type NOT IN('monthly','yearly')
    OR p_payment_date IS NULL OR p_payment_date>CURRENT_DATE OR p_payment_date<CURRENT_DATE-3650
    OR (p_payment_time IS NOT NULL AND p_payment_time !~ '^([01][0-9]|2[0-3]):[0-5][0-9](:[0-5][0-9])?$')
    OR length(COALESCE(p_notes,''))>2000
    OR p_receipt_image_url IS NOT NULL
    OR NOT EXISTS(SELECT 1 FROM payment_methods WHERE code=p_payment_method_code AND is_active=TRUE)
  THEN RAISE EXCEPTION 'invalid addon request'; END IF;
  v_unit:=CASE p_addon_type
    WHEN 'extra_user' THEN CASE WHEN p_duration_type='monthly' THEN 5 ELSE 48 END
    WHEN 'extra_branch' THEN CASE WHEN p_duration_type='monthly' THEN 10 ELSE 96 END
    WHEN 'storage_gb' THEN CASE WHEN p_duration_type='monthly' THEN 3 ELSE 30 END
  END;
  v_total:=v_unit*p_quantity;
  INSERT INTO addon_requests(company_id,user_id,addon_type,quantity,duration_type,unit_price_usd,
    total_amount_usd,payment_method_code,payment_amount,payment_date,payment_time,receipt_image_url,notes,status)
  VALUES(p_company_id,p_user_id,p_addon_type,p_quantity,p_duration_type,v_unit,v_total,
    p_payment_method_code,v_total,p_payment_date,p_payment_time,NULL,NULLIF(trim(p_notes),''),'pending')
  RETURNING * INTO v_request;
  INSERT INTO company_messages(company_id,user_id,subject,body,type,status)
  VALUES(p_company_id,p_user_id,format('طلب إضافة: %s ×%s',p_addon_type,p_quantity),
    format('النوع: %s، الكمية: %s، المدة: %s، المبلغ: $%s، طريقة الدفع: %s، الإيصال: عبر تليجرام',
      p_addon_type,p_quantity,p_duration_type,v_total,p_payment_method_code),'addon_request','open');
  INSERT INTO audit_log(company_id,user_id,action,entity_type,entity_id,new_values)
  VALUES(p_company_id,p_user_id,'create','addon_request',v_request.id::TEXT,
    jsonb_build_object('addon_type',p_addon_type,'quantity',p_quantity,'duration_type',p_duration_type,'amount',v_total,'receipt_channel','telegram'));
  RETURN jsonb_build_object('id',v_request.id,'status',v_request.status,'total_amount_usd',v_total);
END;
$$;

CREATE OR REPLACE FUNCTION public.create_upgrade_request_atomic(
  p_company_id UUID,p_user_id UUID,p_requested_plan_id UUID,p_duration_type TEXT,
  p_payment_method_code TEXT,p_payment_amount NUMERIC,p_payment_date DATE,p_payment_time TEXT,
  p_receipt_image_url TEXT,p_notes TEXT
) RETURNS JSONB
LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
DECLARE v_plan subscription_plans%ROWTYPE; v_current_plan UUID; v_expected NUMERIC(15,2); v_request upgrade_requests%ROWTYPE;
BEGIN
  IF NOT EXISTS(
    SELECT 1 FROM users u JOIN companies c ON c.id=u.company_id
    WHERE u.id=p_user_id AND u.company_id=p_company_id AND u.is_active=TRUE AND c.is_active=TRUE
  ) THEN RAISE EXCEPTION 'invalid tenant actor'; END IF;
  SELECT * INTO v_plan FROM subscription_plans WHERE id=p_requested_plan_id AND is_active=TRUE;
  v_expected:=CASE WHEN p_duration_type='monthly' THEN v_plan.price_monthly
    WHEN p_duration_type='yearly' THEN v_plan.price_yearly ELSE NULL END;
  IF v_plan.id IS NULL OR v_expected IS NULL OR v_expected<=0 OR p_payment_amount IS DISTINCT FROM v_expected
    OR p_payment_date IS NULL OR p_payment_date>CURRENT_DATE OR p_payment_date<CURRENT_DATE-3650
    OR (p_payment_time IS NOT NULL AND p_payment_time !~ '^([01][0-9]|2[0-3]):[0-5][0-9](:[0-5][0-9])?$')
    OR length(COALESCE(p_notes,''))>2000
    OR p_receipt_image_url IS NOT NULL
    OR NOT EXISTS(SELECT 1 FROM payment_methods WHERE code=p_payment_method_code AND is_active=TRUE)
  THEN RAISE EXCEPTION 'invalid upgrade request'; END IF;
  SELECT plan_id INTO v_current_plan FROM subscriptions WHERE company_id=p_company_id
    ORDER BY created_at DESC LIMIT 1;
  INSERT INTO upgrade_requests(company_id,user_id,current_plan_id,requested_plan_id,duration_type,
    payment_method_code,payment_amount,payment_date,payment_time,receipt_image_url,notes,status)
  VALUES(p_company_id,p_user_id,v_current_plan,p_requested_plan_id,p_duration_type,p_payment_method_code,
    v_expected,p_payment_date,p_payment_time::TIME,NULL,NULLIF(trim(p_notes),''),'pending')
  RETURNING * INTO v_request;
  INSERT INTO company_messages(company_id,user_id,subject,body,type,status)
  VALUES(p_company_id,p_user_id,format('طلب ترقية إلى %s',v_plan.code),
    format('الباقة: %s، المدة: %s، المبلغ: %s %s، طريقة الدفع: %s، الإيصال: عبر تليجرام',
      v_plan.code,p_duration_type,v_expected,v_plan.currency,p_payment_method_code),'upgrade','open');
  INSERT INTO audit_log(company_id,user_id,action,entity_type,entity_id,new_values)
  VALUES(p_company_id,p_user_id,'create','upgrade_request',v_request.id::TEXT,
    jsonb_build_object('plan_id',p_requested_plan_id,'duration_type',p_duration_type,'amount',v_expected,'receipt_channel','telegram'));
  RETURN jsonb_build_object('id',v_request.id,'status',v_request.status,'plan_code',v_plan.code,
    'payment_amount',v_expected,'created_at',v_request.created_at);
END;
$$;

-- ---------------------------------------------------------------------------
-- 2. Review RPCs — approval no longer requires a stored receipt file.
-- ---------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.review_upgrade_request(
  p_request_id UUID,
  p_admin_id UUID,
  p_decision TEXT,
  p_notes TEXT DEFAULT NULL
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_req upgrade_requests%ROWTYPE;
  v_plan subscription_plans%ROWTYPE;
  v_sub subscriptions%ROWTYPE;
  v_expected NUMERIC;
  v_months INT;
  v_end DATE;
BEGIN
  IF NOT EXISTS (SELECT 1 FROM admin_users WHERE id = p_admin_id AND is_active = true) THEN
    RAISE EXCEPTION 'inactive admin';
  END IF;
  IF p_decision NOT IN ('approved', 'rejected') THEN RAISE EXCEPTION 'invalid decision'; END IF;

  SELECT * INTO v_req FROM upgrade_requests WHERE id = p_request_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'request not found'; END IF;
  IF v_req.status <> 'pending' THEN RAISE EXCEPTION 'request was already reviewed'; END IF;

  IF p_decision = 'rejected' THEN
    UPDATE upgrade_requests SET status = 'rejected', admin_notes = left(p_notes, 2000),
      reviewed_by = p_admin_id, reviewed_at = now(), updated_at = now()
    WHERE id = p_request_id;
    INSERT INTO admin_audit_log(admin_id, action, details, target_type, target_id)
    VALUES (p_admin_id, 'reject_upgrade_request', left(p_notes, 2000), 'upgrade_request', p_request_id::text);
    RETURN jsonb_build_object('status', 'rejected', 'company_id', v_req.company_id);
  END IF;

  SELECT * INTO v_plan FROM subscription_plans
  WHERE id = v_req.requested_plan_id AND is_active = true;
  IF NOT FOUND THEN RAISE EXCEPTION 'requested plan is unavailable'; END IF;
  v_months := CASE WHEN v_req.duration_type = 'yearly' THEN 12 ELSE 1 END;
  v_expected := CASE WHEN v_req.duration_type = 'yearly'
    THEN COALESCE(v_plan.price_yearly, 0) ELSE COALESCE(v_plan.price_monthly, 0) END;

  -- The receipt screenshot arrives on Telegram (out-of-band); approval needs a
  -- recorded transfer date and the full catalogue amount, not a stored file.
  IF v_req.payment_date IS NULL
     OR COALESCE(v_req.payment_amount, 0) < v_expected
     OR v_expected <= 0 THEN
    RAISE EXCEPTION 'verified payment proof and full plan amount are required';
  END IF;

  SELECT * INTO v_sub FROM subscriptions
  WHERE company_id = v_req.company_id
  ORDER BY created_at DESC LIMIT 1 FOR UPDATE;
  v_end := GREATEST(COALESCE(v_sub.end_date, CURRENT_DATE), CURRENT_DATE)
           + make_interval(months => v_months);

  IF v_sub.id IS NULL THEN
    INSERT INTO subscriptions(company_id, plan_id, plan_code, status, start_date, end_date, updated_at)
    VALUES(v_req.company_id, v_plan.id, v_plan.code, 'active', CURRENT_DATE, v_end, now());
  ELSE
    UPDATE subscriptions
    SET plan_id = v_plan.id, plan_code = v_plan.code, status = 'active',
        end_date = v_end, updated_at = now()
    WHERE id = v_sub.id;
  END IF;

  UPDATE upgrade_requests
  SET status = 'approved', admin_notes = left(p_notes, 2000),
      reviewed_by = p_admin_id, reviewed_at = now(), updated_at = now()
  WHERE id = p_request_id;
  INSERT INTO admin_audit_log(admin_id, action, details, target_type, target_id)
  VALUES (p_admin_id, 'approve_upgrade_request',
    format('company=%s plan=%s months=%s amount=%s', v_req.company_id, v_plan.code, v_months, v_req.payment_amount),
    'upgrade_request', p_request_id::text);

  RETURN jsonb_build_object(
    'status', 'approved', 'company_id', v_req.company_id,
    'plan_code', v_plan.code, 'plan_name', v_plan.name,
    'months', v_months, 'end_date', v_end
  );
END;
$$;

CREATE OR REPLACE FUNCTION public.review_addon_request(
  p_request_id UUID,
  p_admin_id UUID,
  p_decision TEXT,
  p_notes TEXT DEFAULT NULL
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_req addon_requests%ROWTYPE;
  v_sub subscriptions%ROWTYPE;
  v_prev_users INT;
  v_prev_branches INT;
  v_new_users INT;
  v_new_branches INT;
  v_months INT;
BEGIN
  IF NOT EXISTS (SELECT 1 FROM admin_users WHERE id = p_admin_id AND is_active = true) THEN
    RAISE EXCEPTION 'inactive admin';
  END IF;
  IF p_decision NOT IN ('approved', 'rejected') THEN RAISE EXCEPTION 'invalid decision'; END IF;

  SELECT * INTO v_req FROM addon_requests WHERE id = p_request_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'request not found'; END IF;
  IF v_req.status <> 'pending' THEN RAISE EXCEPTION 'request was already reviewed'; END IF;

  IF p_decision = 'rejected' THEN
    UPDATE addon_requests SET status = 'rejected', admin_notes = left(p_notes, 2000),
      reviewed_by = p_admin_id, reviewed_at = now(), updated_at = now()
    WHERE id = p_request_id;
    INSERT INTO admin_audit_log(admin_id, action, details, target_type, target_id)
    VALUES (p_admin_id, 'reject_addon_request', left(p_notes, 2000), 'addon_request', p_request_id::text);
    RETURN jsonb_build_object('status', 'rejected', 'company_id', v_req.company_id);
  END IF;

  -- Payment proof lives in the Telegram chat; require the transfer metadata.
  IF v_req.payment_date IS NULL
     OR COALESCE(v_req.payment_amount, 0) < v_req.total_amount_usd THEN
    RAISE EXCEPTION 'verified payment proof and full amount are required';
  END IF;

  SELECT * INTO v_sub FROM subscriptions
  WHERE company_id = v_req.company_id
  ORDER BY created_at DESC LIMIT 1 FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'company has no subscription'; END IF;

  v_prev_users := COALESCE(v_sub.extra_users, 0);
  v_prev_branches := COALESCE(v_sub.extra_branches, 0);
  v_new_users := v_prev_users + CASE WHEN v_req.addon_type = 'extra_user' THEN v_req.quantity ELSE 0 END;
  v_new_branches := v_prev_branches + CASE WHEN v_req.addon_type = 'extra_branch' THEN v_req.quantity ELSE 0 END;
  v_months := CASE WHEN v_req.duration_type = 'yearly' THEN 12 ELSE 1 END;

  UPDATE subscriptions
  SET extra_users = v_new_users,
      extra_branches = v_new_branches,
      extra_storage_gb = COALESCE(extra_storage_gb, 0)
        + CASE WHEN v_req.addon_type = 'storage_gb' THEN v_req.quantity ELSE 0 END,
      updated_at = now()
  WHERE id = v_sub.id;

  UPDATE addon_requests
  SET status = 'approved', admin_notes = left(p_notes, 2000),
      reviewed_by = p_admin_id, reviewed_at = now(), updated_at = now()
  WHERE id = p_request_id;

  INSERT INTO addon_grant_audit(
    company_id, request_id, admin_id, addon_type, quantity, months_granted,
    previous_extra_users, previous_extra_branches, new_extra_users, new_extra_branches, note
  ) VALUES (
    v_req.company_id, v_req.id, p_admin_id, v_req.addon_type, v_req.quantity, v_months,
    v_prev_users, v_prev_branches, v_new_users, v_new_branches, left(p_notes, 2000)
  );
  INSERT INTO admin_audit_log(admin_id, action, details, target_type, target_id)
  VALUES (p_admin_id, 'approve_addon_request',
    format('company=%s type=%s quantity=%s', v_req.company_id, v_req.addon_type, v_req.quantity),
    'addon_request', p_request_id::text);

  RETURN jsonb_build_object(
    'status', 'approved', 'company_id', v_req.company_id,
    'addon_type', v_req.addon_type, 'quantity', v_req.quantity,
    'extra_users', v_new_users, 'extra_branches', v_new_branches
  );
END;
$$;

-- Self-service cancellation of a still-pending request frees the
-- partial-unique "one pending request" slot, so a customer who typo'd the
-- amount can withdraw and resubmit without developer involvement.

CREATE OR REPLACE FUNCTION public.cancel_own_subscription_request(
  p_company_id UUID,
  p_user_id UUID,
  p_request_id UUID,
  p_kind TEXT
) RETURNS JSONB
LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
DECLARE v_count INTEGER;
BEGIN
  IF NOT EXISTS(
    SELECT 1 FROM users u WHERE u.id=p_user_id AND u.company_id=p_company_id AND u.is_active=TRUE
  ) THEN RAISE EXCEPTION 'invalid tenant actor'; END IF;
  IF p_kind NOT IN ('upgrade','addon') THEN RAISE EXCEPTION 'invalid request kind'; END IF;

  IF p_kind = 'upgrade' THEN
    UPDATE upgrade_requests SET status='cancelled', updated_at=now()
    WHERE id=p_request_id AND company_id=p_company_id AND user_id=p_user_id AND status='pending';
  ELSE
    UPDATE addon_requests SET status='cancelled', updated_at=now()
    WHERE id=p_request_id AND company_id=p_company_id AND user_id=p_user_id AND status='pending';
  END IF;
  GET DIAGNOSTICS v_count = ROW_COUNT;
  IF v_count = 0 THEN RAISE EXCEPTION 'request not found or already reviewed'; END IF;

  INSERT INTO audit_log(company_id,user_id,action,entity_type,entity_id,new_values)
  VALUES(p_company_id,p_user_id,'cancel', p_kind || '_request', p_request_id::TEXT,
    jsonb_build_object('by','owner'));
  RETURN jsonb_build_object('id',p_request_id,'status','cancelled');
END;
$$;
REVOKE ALL ON FUNCTION public.cancel_own_subscription_request(UUID,UUID,UUID,TEXT) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.cancel_own_subscription_request(UUID,UUID,UUID,TEXT) TO service_role;

REVOKE ALL ON FUNCTION public.create_addon_request_atomic(UUID,UUID,TEXT,INTEGER,TEXT,TEXT,DATE,TEXT,TEXT,TEXT) FROM PUBLIC,anon,authenticated;
REVOKE ALL ON FUNCTION public.create_upgrade_request_atomic(UUID,UUID,UUID,TEXT,TEXT,NUMERIC,DATE,TEXT,TEXT,TEXT) FROM PUBLIC,anon,authenticated;
REVOKE ALL ON FUNCTION public.review_upgrade_request(UUID, UUID, TEXT, TEXT) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.review_addon_request(UUID, UUID, TEXT, TEXT) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.create_addon_request_atomic(UUID,UUID,TEXT,INTEGER,TEXT,TEXT,DATE,TEXT,TEXT,TEXT) TO service_role;
GRANT EXECUTE ON FUNCTION public.create_upgrade_request_atomic(UUID,UUID,UUID,TEXT,TEXT,NUMERIC,DATE,TEXT,TEXT,TEXT) TO service_role;
GRANT EXECUTE ON FUNCTION public.review_upgrade_request(UUID, UUID, TEXT, TEXT) TO service_role;
GRANT EXECUTE ON FUNCTION public.review_addon_request(UUID, UUID, TEXT, TEXT) TO service_role;

SELECT 'Migration 115 completed — payment proofs via Telegram, cancellable pending requests' AS result;
