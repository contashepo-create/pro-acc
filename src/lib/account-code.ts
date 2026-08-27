import type { SupabaseLike } from './types';


/**
 * رموز الحسابات: الأب 4 أرقام ثم تسلسل الفرع.
 * الشكل المخزَّن: 1110-0001 (الأب أولاً). في واجهة RTL بدون عزل الاتجاه
 * يظهر الرمز مقلوباً (0001-1110) فيُظن أن الترتيب خطأ أو أن الحساب غير موجود.
 */

export const ACCOUNT_CODE_RE = /^\d{4}(?:-\d{1,6})?$/;

export function normalizeAccountCode(raw: string | null | undefined): string {
  return String(raw || '').trim().replace(/\s+/g, '');
}

/** كل الأشكال المحتملة لنفس الرمز (الأصلي + المقلوب بسبب RTL). */
export function accountCodeLookupKeys(raw: string): string[] {
  const code = normalizeAccountCode(raw);
  if (!code) return [];
  const keys = new Set<string>([code]);

  const hyphen = code.match(/^(\d{4})-(\d{1,6})$/);
  if (hyphen) {
    const [, parent, suffix] = hyphen;
    keys.add(`${parent}${suffix.padStart(4, '0')}`);
    keys.add(`${suffix}-${parent}`);
    keys.add(parent);
  }

  const reversed = code.match(/^(\d{1,6})-(\d{4})$/);
  if (reversed) {
    const [, suffix, parent] = reversed;
    keys.add(`${parent}-${suffix.padStart(4, '0')}`);
    keys.add(`${parent}-${suffix}`);
    keys.add(`${parent}${suffix.padStart(4, '0')}`);
    keys.add(parent);
  }

  const glued = code.match(/^(\d{4})(\d{4})$/);
  if (glued) {
    const [, parent, suffix] = glued;
    keys.add(`${parent}-${suffix}`);
    keys.add(parent);
  }

  return [...keys];
}

export function nextChildAccountCode(parentCode: string, existingCodes: string[]): string {
  const parent = normalizeAccountCode(parentCode);
  let maxSuffix = 0;
  for (const raw of existingCodes) {
    const code = normalizeAccountCode(raw);
    if (code.startsWith(`${parent}-`)) {
      const n = parseInt(code.slice(parent.length + 1), 10);
      if (!Number.isNaN(n) && n > maxSuffix) maxSuffix = n;
    } else if (code.startsWith(parent) && code.length > parent.length && /^\d+$/.test(code.slice(parent.length))) {
      const n = parseInt(code.slice(parent.length), 10);
      if (n > maxSuffix) maxSuffix = n;
    } else if (code.endsWith(`-${parent}`)) {
      const n = parseInt(code.slice(0, code.length - parent.length - 1), 10);
      if (!Number.isNaN(n) && n > maxSuffix) maxSuffix = n;
    }
  }
  return `${parent}-${String(maxSuffix + 1).padStart(4, '0')}`;
}

export async function findAccountByCode(
  supabase: SupabaseLike,
  companyId: string,
  rawCode: string,
): Promise<{ id: string; code: string; name?: string; is_header?: boolean } | null> {
  const keys = accountCodeLookupKeys(rawCode);
  for (const code of keys) {
    const { data } = await supabase
      .from('accounts')
      .select('id, code, name, is_header')
      .eq('company_id', companyId)
      .eq('code', code)
      .maybeSingle();
    if (data) return data as { id: string; code: string; name?: string; is_header?: boolean };
  }
  return null;
}
