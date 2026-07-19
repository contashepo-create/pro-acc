/**
 * سياسات كلمات المرور الآمنة
 */

/**
 * التحقق من قوة كلمة المرور
 */
export function validatePasswordStrength(password: string): { valid: boolean; score: number; errors: string[] } {
  const errors: string[] = [];
  let score = 0;

  // الحد الأدنى للطول
  if (password.length < 12) {
    errors.push('كلمة المرور يجب أن تكون 12 حرف على الأقل');
  } else {
    score += 2;
  }

  // التحقق من وجود أحرف كبيرة
  if (/[A-Z]/.test(password)) {
    score += 1;
  } else {
    errors.push('يجب أن تحتوي على أحرف كبيرة');
  }

  // التحقق من وجود أحرف صغيرة
  if (/[a-z]/.test(password)) {
    score += 1;
  } else {
    errors.push('يجب أن تحتوي على أحرف صغيرة');
  }

  // التحقق من وجود أرقام
  if (/\d/.test(password)) {
    score += 1;
  } else {
    errors.push('يجب أن تحتوي على أرقام');
  }

  // التحقق من وجود رموز خاصة
  if (/[!@#$%^&*(),.?":{}|<>]/.test(password)) {
    score += 1;
  } else {
    errors.push('يجب أن تحتوي على رموز خاصة (!@#$%^&*(),.?":{}|<>)');
  }

  // التحقق من عدم وجود كلمات شائعة
  const commonPasswords = ['password', '123456', 'qwerty', 'admin', '12345678', 'abc123'];
  if (commonPasswords.includes(password.toLowerCase())) {
    errors.push('كلمة المرور شائعة جداً، استخدم كلمة أكثر قوة');
    score = Math.max(0, score - 3);
  }

  // التحقق من عدم وجود كلمات بالعربية
  const arabicCommonPasswords = ['كلمةالمرور', '123456', 'كلمةسر', 'مدير', 'المدير'];
  if (arabicCommonPasswords.includes(password.toLowerCase())) {
    errors.push('كلمة المرور شائعة جداً، استخدم كلمة أكثر قوة');
    score = Math.max(0, score - 3);
  }

  // درجة القوة (0-7)
  const strength = Math.min(7, Math.max(0, score));

  return {
    valid: errors.length === 0,
    score: strength,
    errors,
  };
}

/**
 * التحقق من صحة كلمة المرور للتسجيل
 */
export function validatePasswordForRegistration(password: string): { valid: boolean; errors: string[] } {
  const result = validatePasswordStrength(password);
  
  // إضافة شروط إضافية للتسجيل
  if (password.length > 128) {
    result.errors.push('كلمة المرور طويلة جداً');
    result.valid = false;
  }

  // التحقق من عدم وجود معلومات شخصية
  const userInfoPatterns = [
    /admin/i,
    /manager/i,
    /company/i,
    /email/i,
    /name/i,
    /سنة/i,
    /تاريخ/i,
  ];
  
  for (const pattern of userInfoPatterns) {
    if (pattern.test(password)) {
      result.errors.push('كلمة المرور لا يجب أن تحتوي على معلومات شخصية');
      result.valid = false;
      break;
    }
  }

  return {
    valid: result.valid,
    errors: result.errors,
  };
}

/**
 * وصف قوة كلمة المرور
 */
export function getPasswordDescription(score: number): string {
  if (score <= 2) return 'ضعيفة جداً';
  if (score <= 3) return 'ضعيفة';
  if (score <= 4) return 'متوسطة';
  if (score <= 5) return 'جيدة';
  if (score <= 6) return 'قوية';
  return 'قوية جداً';
}

/**
 * متطلبات كلمة المرور الموصى بها
 */
export function getPasswordRequirements(): string[] {
  return [
    '12 حرف على الأقل',
    'أحرف كبيرة (A-Z)',
    'أحرف صغيرة (a-z)',
    'أرقام (0-9)',
    'رموز خاصة (!@#$%^&*(),.?":{}|<>)',
    'ليست كلمة شائعة',
  ];
}