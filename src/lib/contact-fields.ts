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

const MISSING_COL = /column|42703|Could not find|schema cache/i;

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

/** تحديث/إدراج مع إسقاط الأعمدة غير الموجودة في قاعدة الإنتاج. */
export async function writeContact(
  supabase: any,
  mode: 'insert' | 'update',
  payload: Record<string, any>,
  opts: { companyId: string; id?: string },
) {
  let row = { ...payload };
  for (let attempt = 0; attempt < 12; attempt++) {
    const q = mode === 'insert'
      ? supabase.from('contacts').insert({ company_id: opts.companyId, ...row, is_active: row.is_active ?? true }).select('*').single()
      : supabase.from('contacts').update(row).eq('id', opts.id).eq('company_id', opts.companyId).select('*').single();
    const { data, error } = await q;
    if (!error && data) return { data, error: null };
    const msg = `${error?.message || ''} ${error?.details || ''} ${error?.hint || ''}`;
    if (!MISSING_COL.test(msg)) return { data: null, error };
    const m = msg.match(/['\"]([a-z_]+)['\"]/i);
    const bad = m?.[1];
    if (!bad || !(bad in row)) return { data: null, error };
    delete row[bad];
  }
  return { data: null, error: { message: 'تعذر حفظ بعض الحقول — راجع أعمدة جدول الأطراف' } };
}
