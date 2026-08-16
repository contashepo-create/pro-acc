/** حقول الطرف (عميل/مورد) التي يرسلها النموذج ويجب أن تُحفظ فعلياً. */
export const CONTACT_TEXT_FIELDS = [
  'name', 'type', 'phone', 'email', 'address',
  'tax_number', 'commercial_registration',
  'contact_person', 'contact_person_phone', 'contact_person_email',
  'city', 'region', 'country', 'postal_code', 'website',
  'iban', 'bank_name', 'swift_code',
  'payment_terms', 'notes', 'date_of_birth', 'gender', 'national_id', 'category',
] as const;

export const CONTACT_NUMBER_FIELDS = ['credit_limit'] as const;

export function pickContactFields(body: Record<string, any>, { requireName = false } = {}) {
  const out: Record<string, any> = {};
  for (const key of CONTACT_TEXT_FIELDS) {
    if (body[key] === undefined) continue;
    const v = body[key];
    if (v === '') out[key] = null;
    else out[key] = typeof v === 'string' ? v.trim() : v;
  }
  for (const key of CONTACT_NUMBER_FIELDS) {
    if (body[key] === undefined) continue;
    const n = Number(body[key]);
    out[key] = Number.isFinite(n) ? n : 0;
  }
  if (requireName && (!out.name || String(out.name).trim() === '')) {
    return { error: 'اسم الطرف مطلوب', data: null as Record<string, any> | null };
  }
  if (out.email && typeof out.email === 'string' && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(out.email)) {
    return { error: 'البريد الإلكتروني غير صالح', data: null };
  }
  return { error: null as string | null, data: out };
}
