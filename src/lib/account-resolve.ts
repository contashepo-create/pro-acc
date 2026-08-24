import type { Row, SupabaseLike } from './types';

/**
 * تمييز الحسابات الرئيسية (غير قابلة للترحيل) وحل حسابات النقدية/البنوك الفعلية.
 * البرامج المحاسبية لا ترحّل على المجموعات (الأصول، الخصوم، البنوك كمجموعة).
 */
export const HEADER_ACCOUNT_CODES = new Set([
  '1000', // الأصول
  '1100', // الأصول المتداولة
  '1200', // الأصول الثابتة
  '2000', // الخصوم
  '2100', // الخصوم المتداولة
  '2200', // الخصوم غير المتداولة
  '3000', // حقوق الملكية
  '4000', // الإيرادات
  '5000', // المصروفات
  '5100', // تكلفة مباشرة
  '5200', // مصروفات تشغيلية
]);

export function isHeaderAccount(acc: {
  code?: string | null;
  is_header?: boolean | null;
  children?: unknown[] | null;
} | null): boolean {
  if (acc?.is_header === true) return true;
  if (Array.isArray(acc?.children) && acc.children.length > 0) return true;
  if (acc?.code && HEADER_ACCOUNT_CODES.has(String(acc.code))) return true;
  return false;
}

export function isCashOrBankCode(code: string | null | undefined): boolean {
  if (!code) return false;
  return (
    code === '1110' ||
    code === '1120' ||
    code.startsWith('1110-') ||
    code.startsWith('1120-') ||
    code.endsWith('-1110') ||
    code.endsWith('-1120') ||
    /^1110\d{4}$/.test(code) ||
    /^1120\d{4}$/.test(code)
  );
}

/**
 * حساب الدفع الافتراضي: خزينة/بنك مسجّل في banks_safes ثم 1110 ثم 1120.
 */
export async function resolvePaymentAccountId(
  supabase: SupabaseLike,
  companyId: string,
  preferredBankSafeId?: string | null,
): Promise<string | null> {
  if (preferredBankSafeId) {
    const { data } = await supabase
      .from('banks_safes')
      .select('account_id')
      .eq('id', preferredBankSafeId)
      .eq('company_id', companyId)
      .maybeSingle();
    if (data?.account_id) return String(data.account_id);
  }

  const { data: safes } = await supabase
    .from('banks_safes')
    .select('account_id, type')
    .eq('company_id', companyId)
    .eq('is_active', true)
    .order('type'); // safe قبل bank أبجدياً؟ type: bank < safe — نفضّل الخزينة
  const rows = (safes || []).filter((r: Row) => r.account_id);
  const cash = rows.find((r: Row) => r.type === 'safe');
  if (cash?.account_id) return String(cash.account_id);
  if (rows[0]?.account_id) return String(rows[0].account_id);

  for (const code of ['1110', '1120']) {
    const { data: acc } = await supabase
      .from('accounts')
      .select('id')
      .eq('company_id', companyId)
      .eq('code', code)
      .maybeSingle();
    if (acc?.id) return String(acc.id);
  }
  return null;
}

export async function listCashBankAccountIds(
  supabase: SupabaseLike,
  companyId: string,
): Promise<string[]> {
  const ids = new Set<string>();
  const { data: accounts } = await supabase
    .from('accounts')
    .select('id, code')
    .eq('company_id', companyId);
  for (const a of accounts || []) {
    if (isCashOrBankCode(String(a.code))) ids.add(String(a.id));
  }
  const { data: safes } = await supabase
    .from('banks_safes')
    .select('account_id')
    .eq('company_id', companyId);
  for (const s of safes || []) {
    if (s.account_id) ids.add(String(s.account_id));
  }
  return [...ids];
}
