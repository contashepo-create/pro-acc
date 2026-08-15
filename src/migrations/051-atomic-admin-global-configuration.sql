-- ============================================================
-- 051 - Atomic administration of global configuration
--
-- Global settings, advertisements, payment methods and support-ticket
-- decisions are security-sensitive writes.  Keep each mutation and its
-- admin audit record in one transaction, and re-check the trusted admin
-- inside SECURITY DEFINER functions (the API uses the service role).
-- ============================================================

BEGIN;

-- Align the database enums with the values exposed by the administration UI.
DO $$
DECLARE r RECORD;
BEGIN
  FOR r IN
    SELECT c.conname
    FROM pg_constraint c
    JOIN pg_class t ON t.oid = c.conrelid
    JOIN pg_namespace n ON n.oid = t.relnamespace
    JOIN pg_attribute a ON a.attrelid = t.oid AND a.attnum = ANY(c.conkey)
    WHERE n.nspname = 'public' AND t.relname = 'advertisements'
      AND c.contype = 'c' AND a.attname IN ('type', 'display_mode')
  LOOP
    EXECUTE 'ALTER TABLE public.advertisements DROP CONSTRAINT IF EXISTS ' || quote_ident(r.conname);
  END LOOP;
END $$;

UPDATE advertisements SET type='announcement'
WHERE type IS NULL OR type NOT IN ('announcement','banner','promotion','upgrade','alert','info','feature','premium');
UPDATE advertisements SET display_mode='banner'
WHERE display_mode IS NULL OR display_mode NOT IN ('top_bar','banner','popup','modal','inline');
ALTER TABLE advertisements ALTER COLUMN display_mode SET DEFAULT 'banner';

ALTER TABLE advertisements
  ADD CONSTRAINT advertisements_type_check
    CHECK (type IN ('announcement','banner','promotion','upgrade','alert','info','feature','premium')),
  ADD CONSTRAINT advertisements_display_mode_check
    CHECK (display_mode IN ('top_bar','banner','popup','modal','inline'));

CREATE OR REPLACE FUNCTION public.assert_active_admin(p_admin_id UUID)
RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF p_admin_id IS NULL OR NOT EXISTS (
    SELECT 1 FROM admin_users WHERE id = p_admin_id AND is_active = TRUE
  ) THEN
    RAISE EXCEPTION 'inactive admin';
  END IF;
END;
$$;

CREATE OR REPLACE FUNCTION public.admin_upsert_app_settings(
  p_admin_id UUID,
  p_updates JSONB
) RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_key TEXT;
  v_value JSONB;
  v_text TEXT;
  v_count INT := 0;
BEGIN
  PERFORM assert_active_admin(p_admin_id);
  IF p_updates IS NULL OR jsonb_typeof(p_updates) <> 'object'
     OR (SELECT count(*) FROM jsonb_object_keys(p_updates)) NOT BETWEEN 1 AND 50 THEN
    RAISE EXCEPTION 'invalid settings payload';
  END IF;

  FOR v_key, v_value IN SELECT key, value FROM jsonb_each(p_updates)
  LOOP
    IF v_key !~ '^[a-z][a-z0-9_]{1,63}$'
       OR jsonb_typeof(v_value) NOT IN ('string','number','boolean') THEN
      RAISE EXCEPTION 'invalid setting key or value';
    END IF;
    v_text := CASE WHEN jsonb_typeof(v_value) = 'string' THEN v_value #>> '{}' ELSE v_value::TEXT END;
    IF length(v_text) > 5000 THEN RAISE EXCEPTION 'setting value too long'; END IF;

    INSERT INTO app_settings(key, value, category, updated_by, updated_at)
    VALUES(v_key, v_text, 'custom', p_admin_id, now())
    ON CONFLICT (key) DO UPDATE
      SET value = EXCLUDED.value, updated_by = p_admin_id, updated_at = now();
    v_count := v_count + 1;
  END LOOP;

  INSERT INTO admin_audit_log(admin_id, action, details, target_type, target_id)
  VALUES(p_admin_id, 'update_app_settings',
    format('updated %s keys: %s', v_count, array_to_string(ARRAY(SELECT jsonb_object_keys(p_updates)), ',')),
    'app_settings', 'bulk');
  RETURN jsonb_build_object('updated', v_count);
END;
$$;

CREATE OR REPLACE FUNCTION public.admin_update_app_setting(
  p_admin_id UUID,
  p_key TEXT,
  p_patch JSONB
) RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE v_row app_settings%ROWTYPE;
BEGIN
  PERFORM assert_active_admin(p_admin_id);
  IF p_key IS NULL OR p_key !~ '^[a-z][a-z0-9_]{1,63}$'
     OR p_patch IS NULL OR jsonb_typeof(p_patch) <> 'object'
     OR (SELECT count(*) FROM jsonb_object_keys(p_patch)) = 0
     OR EXISTS (SELECT 1 FROM jsonb_object_keys(p_patch) k WHERE k NOT IN ('value','category','description'))
     OR EXISTS (SELECT 1 FROM jsonb_each(p_patch) item WHERE jsonb_typeof(item.value) <> 'string') THEN
    RAISE EXCEPTION 'invalid setting patch';
  END IF;
  IF p_patch ? 'value' AND length(COALESCE(p_patch->>'value','')) > 5000 THEN RAISE EXCEPTION 'setting value too long'; END IF;
  IF p_patch ? 'category' AND (length(COALESCE(p_patch->>'category','')) > 50 OR COALESCE(p_patch->>'category','') !~ '^[a-z][a-z0-9_-]*$') THEN
    RAISE EXCEPTION 'invalid setting category';
  END IF;
  IF p_patch ? 'description' AND length(COALESCE(p_patch->>'description','')) > 500 THEN RAISE EXCEPTION 'setting description too long'; END IF;

  UPDATE app_settings
  SET value = CASE WHEN p_patch ? 'value' THEN COALESCE(p_patch->>'value','') ELSE value END,
      category = CASE WHEN p_patch ? 'category' THEN p_patch->>'category' ELSE category END,
      description = CASE WHEN p_patch ? 'description' THEN p_patch->>'description' ELSE description END,
      updated_by = p_admin_id,
      updated_at = now()
  WHERE key = p_key
  RETURNING * INTO v_row;
  IF NOT FOUND THEN RETURN jsonb_build_object('not_found', TRUE); END IF;

  INSERT INTO admin_audit_log(admin_id, action, details, target_type, target_id)
  VALUES(p_admin_id, 'update_app_setting', 'updated fields: ' || array_to_string(ARRAY(SELECT jsonb_object_keys(p_patch)), ','), 'app_setting', p_key);
  RETURN to_jsonb(v_row);
END;
$$;

CREATE OR REPLACE FUNCTION public.admin_delete_app_setting(
  p_admin_id UUID,
  p_key TEXT
) RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE v_value TEXT;
BEGIN
  PERFORM assert_active_admin(p_admin_id);
  IF p_key IS NULL OR p_key !~ '^[a-z][a-z0-9_]{1,63}$' THEN RAISE EXCEPTION 'invalid setting key'; END IF;
  IF p_key = ANY(ARRAY[
    'app_name','app_name_en','app_version','developer_name','support_email','support_phone',
    'support_whatsapp','support_telegram','support_website','payment_info','payment_bank_name',
    'payment_iban','payment_stc_pay','footer_text','currency_default','locale_default',
    'trial_days','storage_quota_mb'
  ]) THEN
    RETURN jsonb_build_object('protected', TRUE);
  END IF;

  DELETE FROM app_settings WHERE key = p_key RETURNING value INTO v_value;
  IF NOT FOUND THEN RETURN jsonb_build_object('not_found', TRUE); END IF;
  INSERT INTO admin_audit_log(admin_id, action, details, target_type, target_id)
  VALUES(p_admin_id, 'delete_app_setting', 'deleted custom setting', 'app_setting', p_key);
  RETURN jsonb_build_object('deleted', TRUE);
END;
$$;

CREATE OR REPLACE FUNCTION public.admin_manage_advertisement(
  p_admin_id UUID,
  p_action TEXT,
  p_ad_id UUID DEFAULT NULL,
  p_payload JSONB DEFAULT '{}'::JSONB
) RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE v_ad advertisements%ROWTYPE;
BEGIN
  PERFORM assert_active_admin(p_admin_id);
  IF p_action NOT IN ('create','update','delete') OR p_payload IS NULL OR jsonb_typeof(p_payload) <> 'object' THEN
    RAISE EXCEPTION 'invalid advertisement action';
  END IF;

  IF p_action = 'create' THEN
    IF length(trim(COALESCE(p_payload->>'title',''))) NOT BETWEEN 1 AND 300
       OR length(trim(COALESCE(p_payload->>'body',''))) NOT BETWEEN 1 AND 5000
       OR COALESCE(p_payload->>'type','announcement') NOT IN ('announcement','banner','promotion','upgrade','alert','info','feature','premium')
       OR COALESCE(p_payload->>'display_mode','top_bar') NOT IN ('top_bar','banner','popup','modal','inline')
       OR COALESCE((p_payload->>'priority')::INT,0) NOT BETWEEN -1000 AND 1000
       OR length(COALESCE(p_payload->>'link_text','')) > 200
       OR (NULLIF(p_payload->>'link_url','') IS NOT NULL AND (length(p_payload->>'link_url') > 2000 OR p_payload->>'link_url' !~* '^https?://')) THEN
      RAISE EXCEPTION 'invalid advertisement payload';
    END IF;
    INSERT INTO advertisements(title, body, type, display_mode, priority, link_url, link_text, is_active, expires_at, show_until)
    VALUES(
      trim(p_payload->>'title'), trim(p_payload->>'body'), COALESCE(p_payload->>'type','announcement'),
      COALESCE(p_payload->>'display_mode','top_bar'), COALESCE((p_payload->>'priority')::INT,0),
      NULLIF(p_payload->>'link_url',''), NULLIF(p_payload->>'link_text',''),
      COALESCE((p_payload->>'is_active')::BOOLEAN,TRUE),
      NULLIF(p_payload->>'expires_at','')::TIMESTAMPTZ, NULLIF(p_payload->>'expires_at','')::TIMESTAMPTZ
    ) RETURNING * INTO v_ad;
  ELSE
    IF p_ad_id IS NULL THEN RAISE EXCEPTION 'advertisement id required'; END IF;
    SELECT * INTO v_ad FROM advertisements WHERE id = p_ad_id FOR UPDATE;
    IF NOT FOUND THEN RETURN jsonb_build_object('not_found', TRUE); END IF;

    IF p_action = 'delete' THEN
      DELETE FROM advertisements WHERE id = p_ad_id;
      INSERT INTO admin_audit_log(admin_id, action, details, target_type, target_id)
      VALUES(p_admin_id, 'delete_advertisement', left(v_ad.title,300), 'advertisement', p_ad_id::TEXT);
      RETURN jsonb_build_object('deleted', TRUE);
    END IF;

    IF p_payload ? 'title' AND length(trim(COALESCE(p_payload->>'title',''))) NOT BETWEEN 1 AND 300 THEN RAISE EXCEPTION 'invalid advertisement title'; END IF;
    IF p_payload ? 'body' AND length(trim(COALESCE(p_payload->>'body',''))) NOT BETWEEN 1 AND 5000 THEN RAISE EXCEPTION 'invalid advertisement body'; END IF;
    IF p_payload ? 'type' AND p_payload->>'type' NOT IN ('announcement','banner','promotion','upgrade','alert','info','feature','premium') THEN RAISE EXCEPTION 'invalid advertisement type'; END IF;
    IF p_payload ? 'display_mode' AND p_payload->>'display_mode' NOT IN ('top_bar','banner','popup','modal','inline') THEN RAISE EXCEPTION 'invalid advertisement display mode'; END IF;
    IF p_payload ? 'priority' AND (p_payload->>'priority')::INT NOT BETWEEN -1000 AND 1000 THEN RAISE EXCEPTION 'invalid advertisement priority'; END IF;
    IF p_payload ? 'link_text' AND length(COALESCE(p_payload->>'link_text','')) > 200 THEN RAISE EXCEPTION 'invalid advertisement link text'; END IF;
    IF p_payload ? 'link_url' AND NULLIF(p_payload->>'link_url','') IS NOT NULL
       AND (length(p_payload->>'link_url') > 2000 OR p_payload->>'link_url' !~* '^https?://') THEN RAISE EXCEPTION 'invalid advertisement link'; END IF;

    UPDATE advertisements SET
      title = CASE WHEN p_payload ? 'title' THEN trim(p_payload->>'title') ELSE title END,
      body = CASE WHEN p_payload ? 'body' THEN trim(p_payload->>'body') ELSE body END,
      type = CASE WHEN p_payload ? 'type' THEN p_payload->>'type' ELSE type END,
      display_mode = CASE WHEN p_payload ? 'display_mode' THEN p_payload->>'display_mode' ELSE display_mode END,
      priority = CASE WHEN p_payload ? 'priority' THEN (p_payload->>'priority')::INT ELSE priority END,
      link_url = CASE WHEN p_payload ? 'link_url' THEN NULLIF(p_payload->>'link_url','') ELSE link_url END,
      link_text = CASE WHEN p_payload ? 'link_text' THEN NULLIF(p_payload->>'link_text','') ELSE link_text END,
      is_active = CASE WHEN p_payload ? 'is_active' THEN (p_payload->>'is_active')::BOOLEAN ELSE is_active END,
      expires_at = CASE WHEN p_payload ? 'expires_at' THEN NULLIF(p_payload->>'expires_at','')::TIMESTAMPTZ ELSE expires_at END,
      show_until = CASE WHEN p_payload ? 'expires_at' THEN NULLIF(p_payload->>'expires_at','')::TIMESTAMPTZ ELSE show_until END,
      updated_at = now()
    WHERE id = p_ad_id RETURNING * INTO v_ad;
  END IF;

  INSERT INTO admin_audit_log(admin_id, action, details, target_type, target_id)
  VALUES(p_admin_id, p_action || '_advertisement', left(v_ad.title,300), 'advertisement', v_ad.id::TEXT);
  RETURN to_jsonb(v_ad);
END;
$$;

CREATE OR REPLACE FUNCTION public.admin_manage_payment_method(
  p_admin_id UUID,
  p_action TEXT,
  p_method_id UUID DEFAULT NULL,
  p_payload JSONB DEFAULT '{}'::JSONB
) RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE v_method payment_methods%ROWTYPE;
BEGIN
  PERFORM assert_active_admin(p_admin_id);
  IF p_action NOT IN ('create','update','deactivate') OR p_payload IS NULL OR jsonb_typeof(p_payload) <> 'object' THEN
    RAISE EXCEPTION 'invalid payment method action';
  END IF;

  IF p_action = 'create' THEN
    IF COALESCE(p_payload->>'code','') !~ '^[a-z0-9][a-z0-9_-]{1,49}$'
       OR length(trim(COALESCE(p_payload->>'name_ar',''))) NOT BETWEEN 1 AND 120
       OR length(COALESCE(p_payload->>'name_en','')) > 120
       OR length(COALESCE(p_payload->>'description','')) > 500
       OR length(COALESCE(p_payload->>'account_number','')) > 200
       OR length(COALESCE(p_payload->>'account_name','')) > 200
       OR length(COALESCE(p_payload->>'instructions','')) > 2000
       OR COALESCE((p_payload->>'sort_order')::INT,0) NOT BETWEEN 0 AND 10000 THEN
      RAISE EXCEPTION 'invalid payment method payload';
    END IF;
    INSERT INTO payment_methods(code,name_ar,name_en,description,account_number,account_name,instructions,is_active,sort_order)
    VALUES(
      p_payload->>'code', trim(p_payload->>'name_ar'), NULLIF(p_payload->>'name_en',''),
      NULLIF(p_payload->>'description',''), NULLIF(p_payload->>'account_number',''),
      NULLIF(p_payload->>'account_name',''), NULLIF(p_payload->>'instructions',''),
      COALESCE((p_payload->>'is_active')::BOOLEAN,TRUE), COALESCE((p_payload->>'sort_order')::INT,0)
    ) RETURNING * INTO v_method;
  ELSE
    IF p_method_id IS NULL THEN RAISE EXCEPTION 'payment method id required'; END IF;
    SELECT * INTO v_method FROM payment_methods WHERE id = p_method_id FOR UPDATE;
    IF NOT FOUND THEN RETURN jsonb_build_object('not_found', TRUE); END IF;
    IF p_action = 'deactivate' THEN
      UPDATE payment_methods SET is_active=FALSE, updated_at=now() WHERE id=p_method_id RETURNING * INTO v_method;
    ELSE
      IF p_payload ? 'name_ar' AND length(trim(COALESCE(p_payload->>'name_ar',''))) NOT BETWEEN 1 AND 120 THEN RAISE EXCEPTION 'invalid payment method name'; END IF;
      IF length(COALESCE(p_payload->>'name_en','')) > 120
         OR length(COALESCE(p_payload->>'description','')) > 500
         OR length(COALESCE(p_payload->>'account_number','')) > 200
         OR length(COALESCE(p_payload->>'account_name','')) > 200
         OR length(COALESCE(p_payload->>'instructions','')) > 2000
         OR (p_payload ? 'sort_order' AND (p_payload->>'sort_order')::INT NOT BETWEEN 0 AND 10000) THEN
        RAISE EXCEPTION 'invalid payment method patch';
      END IF;
      UPDATE payment_methods SET
        name_ar = CASE WHEN p_payload ? 'name_ar' THEN trim(p_payload->>'name_ar') ELSE name_ar END,
        name_en = CASE WHEN p_payload ? 'name_en' THEN NULLIF(p_payload->>'name_en','') ELSE name_en END,
        description = CASE WHEN p_payload ? 'description' THEN NULLIF(p_payload->>'description','') ELSE description END,
        account_number = CASE WHEN p_payload ? 'account_number' THEN NULLIF(p_payload->>'account_number','') ELSE account_number END,
        account_name = CASE WHEN p_payload ? 'account_name' THEN NULLIF(p_payload->>'account_name','') ELSE account_name END,
        instructions = CASE WHEN p_payload ? 'instructions' THEN NULLIF(p_payload->>'instructions','') ELSE instructions END,
        is_active = CASE WHEN p_payload ? 'is_active' THEN (p_payload->>'is_active')::BOOLEAN ELSE is_active END,
        sort_order = CASE WHEN p_payload ? 'sort_order' THEN (p_payload->>'sort_order')::INT ELSE sort_order END,
        updated_at = now()
      WHERE id=p_method_id RETURNING * INTO v_method;
    END IF;
  END IF;

  INSERT INTO admin_audit_log(admin_id,action,details,target_type,target_id)
  VALUES(p_admin_id,p_action || '_payment_method',format('code=%s name=%s',v_method.code,v_method.name_ar),'payment_method',v_method.id::TEXT);
  RETURN to_jsonb(v_method) || CASE WHEN p_action='deactivate' THEN jsonb_build_object('deactivated',TRUE) ELSE '{}'::JSONB END;
END;
$$;

CREATE OR REPLACE FUNCTION public.admin_update_support_ticket(
  p_admin_id UUID,
  p_ticket_id UUID,
  p_status TEXT DEFAULT NULL,
  p_admin_notes TEXT DEFAULT NULL,
  p_notes_set BOOLEAN DEFAULT FALSE
) RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE v_ticket support_tickets%ROWTYPE; v_label TEXT;
BEGIN
  PERFORM assert_active_admin(p_admin_id);
  IF p_ticket_id IS NULL OR (p_status IS NOT NULL AND p_status NOT IN ('open','in_progress','resolved','closed'))
     OR length(COALESCE(p_admin_notes,'')) > 2000 THEN
    RAISE EXCEPTION 'invalid support update';
  END IF;
  IF p_status IS NULL AND NOT p_notes_set THEN RAISE EXCEPTION 'empty support update'; END IF;

  SELECT * INTO v_ticket FROM support_tickets WHERE id=p_ticket_id FOR UPDATE;
  IF NOT FOUND THEN RETURN jsonb_build_object('not_found',TRUE); END IF;
  UPDATE support_tickets SET
    status=COALESCE(p_status,status),
    admin_notes=CASE WHEN p_notes_set THEN p_admin_notes ELSE admin_notes END,
    updated_at=now()
  WHERE id=p_ticket_id RETURNING * INTO v_ticket;

  v_label := CASE v_ticket.status WHEN 'open' THEN 'مفتوحة' WHEN 'in_progress' THEN 'قيد المعالجة' WHEN 'resolved' THEN 'تم الحل' ELSE 'مغلقة' END;
  IF (p_status IS NOT NULL OR p_notes_set) AND v_ticket.user_id IS NOT NULL THEN
    INSERT INTO company_messages(company_id,user_id,subject,body,type,status)
    VALUES(v_ticket.company_id,v_ticket.user_id,'تحديث للتذكرة: ' || v_ticket.subject,
      'تم تحديث حالة تذكرة الدعم الخاصة بك إلى: ' || v_label || '.' ||
      CASE WHEN p_notes_set AND COALESCE(p_admin_notes,'')<>'' THEN E'\nرد الإدارة: ' || p_admin_notes ELSE '' END,
      'support','open');
  END IF;
  INSERT INTO admin_audit_log(admin_id,action,details,target_type,target_id)
  VALUES(p_admin_id,'update_support_ticket',format('company=%s status=%s',v_ticket.company_id,v_ticket.status),'support_ticket',v_ticket.id::TEXT);
  RETURN jsonb_build_object('id',v_ticket.id,'status',v_ticket.status,'company_id',v_ticket.company_id);
END;
$$;

REVOKE ALL ON FUNCTION public.assert_active_admin(UUID) FROM PUBLIC,anon,authenticated;
REVOKE ALL ON FUNCTION public.admin_upsert_app_settings(UUID,JSONB) FROM PUBLIC,anon,authenticated;
REVOKE ALL ON FUNCTION public.admin_update_app_setting(UUID,TEXT,JSONB) FROM PUBLIC,anon,authenticated;
REVOKE ALL ON FUNCTION public.admin_delete_app_setting(UUID,TEXT) FROM PUBLIC,anon,authenticated;
REVOKE ALL ON FUNCTION public.admin_manage_advertisement(UUID,TEXT,UUID,JSONB) FROM PUBLIC,anon,authenticated;
REVOKE ALL ON FUNCTION public.admin_manage_payment_method(UUID,TEXT,UUID,JSONB) FROM PUBLIC,anon,authenticated;
REVOKE ALL ON FUNCTION public.admin_update_support_ticket(UUID,UUID,TEXT,TEXT,BOOLEAN) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.admin_upsert_app_settings(UUID,JSONB) TO service_role;
GRANT EXECUTE ON FUNCTION public.admin_update_app_setting(UUID,TEXT,JSONB) TO service_role;
GRANT EXECUTE ON FUNCTION public.admin_delete_app_setting(UUID,TEXT) TO service_role;
GRANT EXECUTE ON FUNCTION public.admin_manage_advertisement(UUID,TEXT,UUID,JSONB) TO service_role;
GRANT EXECUTE ON FUNCTION public.admin_manage_payment_method(UUID,TEXT,UUID,JSONB) TO service_role;
GRANT EXECUTE ON FUNCTION public.admin_update_support_ticket(UUID,UUID,TEXT,TEXT,BOOLEAN) TO service_role;

COMMIT;
