-- Critical Security Fixes Migration

-- 1. Add strong password policy constraint
CREATE OR REPLACE FUNCTION validate_password_strength(password TEXT)
RETURNS BOOLEAN AS $$
DECLARE
  min_length INT := 12;
  has_upper BOOL;
  has_lower BOOL;
  has_digit BOOL;
  has_special BOOL;
BEGIN
  -- Length check
  IF LENGTH(password) < min_length THEN
    RETURN FALSE;
  END IF;
  
  -- Character type checks
  has_upper := password ~ '[A-Z]';
  has_lower := password ~ '[a-z]';
  has_digit := password ~ '[0-9]';
  has_special := password ~ '[!@#$%^&*(),.?":{}|<>]';
  
  -- All checks must pass
  RETURN has_upper AND has_lower AND has_digit AND has_special;
END;
$$ LANGUAGE plpgsql;

-- 2. Add password policy to users table
ALTER TABLE users 
ADD CONSTRAINT password_strength_constraint 
CHECK (password_hash IS NULL OR LENGTH(password_hash) > 60);

-- 3. Add function to prevent SQL injection in search
CREATE OR REPLACE FUNCTION sanitize_search_input(search_text TEXT)
RETURNS TEXT AS $$
BEGIN
  -- Remove SQL injection patterns
  search_text := REGEXP_REPLACE(search_text, "[';\"\\-\\-]", '', 'g');
  search_text := REGEXP_REPLACE(search_text, 'DROP|DELETE|INSERT|UPDATE|SELECT|UNION|CREATE|ALTER|TRUNCATE', '', 'gi');
  RETURN TRIM(search_text);
END;
$$ LANGUAGE plpgsql;

-- 4. Add audit log cleanup (prevent data bloat)
CREATE OR REPLACE FUNCTION cleanup_old_audit_logs()
RETURNS INTEGER AS $$
DECLARE
  deleted_count INTEGER;
BEGIN
  -- حذف سجلات المراجعة الأقدم من 90 يوم
  DELETE FROM audit_log
  WHERE created_at < NOW() - INTERVAL '90 days';
  
  GET DIAGNOSTICS deleted_count = ROW_COUNT;
  RETURN deleted_count;
END;
$$ LANGUAGE plpgsql;

-- 5. Add security indexes for better performance
CREATE INDEX IF NOT EXISTS idx_users_email_active 
ON users(email, is_active) 
WHERE is_active = true;

CREATE INDEX IF NOT EXISTS idx_admin_users_active 
ON admin_users(is_active) 
WHERE is_active = true;

CREATE INDEX IF NOT EXISTS idx_audit_log_user_created 
ON audit_log(user_id, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_security_audit_log_ip_created 
ON security_audit_log(ip_address, created_at DESC);

-- 6. Add function to detect suspicious activity
CREATE OR REPLACE FUNCTION detect_suspicious_activity(user_id UUID, company_id UUID)
RETURNS TABLE (is_suspicious BOOLEAN, reason TEXT) AS $$
DECLARE
  v_failed_attempts INT;
  v_recent_actions INT;
  v_different_ips INT;
BEGIN
  -- التحقق من محاولات تسجيل دخول فاشلة
  SELECT COUNT(*)
  INTO v_failed_attempts
  FROM login_attempts
  WHERE user_id = user_id
    AND company_id = company_id
    AND success = false
    AND created_at > NOW() - INTERVAL '1 hour';
  
  -- التحقق من نشاط غير عادي
  SELECT COUNT(DISTINCT DATE(created_at))
  INTO v_recent_actions
  FROM audit_log
  WHERE user_id = user_id
    AND company_id = company_id
    AND created_at > NOW() - INTERVAL '24 hours';
  
  -- التحقق من عناوين IP مختلفة
  SELECT COUNT(DISTINCT ip_address)
  INTO v_different_ips
  FROM audit_log
  WHERE user_id = user_id
    AND company_id = company_id
    AND created_at > NOW() - INTERVAL '24 hours';
  
  -- تحديد النشاط المشبوه
  IF v_failed_attempts >= 5 THEN
    RETURN QUERY SELECT true, 'محاولات تسجيل دخول فاشلة متعددة';
  ELSIF v_different_ips >= 10 THEN
    RETURN QUERY SELECT true, 'نشاط من عناوين IP مختلفة كثيرة';
  ELSIF v_recent_actions >= 50 THEN
    RETURN QUERY SELECT true, 'نشاط مفرط خلال 24 ساعة';
  ELSE
    RETURN QUERY SELECT false, NULL;
  END IF;
END;
$$ LANGUAGE plpgsql;

-- 7. Add comment
COMMENT ON FUNCTION validate_password_strength IS 'Validates password meets security requirements (12+ chars, mixed case, numbers, special chars)';
COMMENT ON FUNCTION sanitize_search_input IS 'Removes SQL injection patterns from search text';