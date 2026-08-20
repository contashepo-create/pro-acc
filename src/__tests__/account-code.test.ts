import {
  accountCodeLookupKeys,
  nextChildAccountCode,
  normalizeAccountCode,
  findAccountByCode,
  ACCOUNT_CODE_RE,
} from '@/lib/account-code';

describe('account codes — order & RTL aliases', () => {
  test('canonical child is parent then sequence', () => {
    expect(nextChildAccountCode('1110', [])).toBe('1110-0001');
    expect(nextChildAccountCode('1120', ['1120-0001', '1120-3148'])).toBe('1120-3149');
    expect(nextChildAccountCode('1110', ['1110-0003', '0001-1110'])).toBe('1110-0004');
  });

  test('lookup accepts reversed hyphen (RTL display) and glued form', () => {
    const keys = accountCodeLookupKeys('0001-1110');
    expect(keys).toContain('1110-0001');
    expect(keys).toContain('1110');
    expect(accountCodeLookupKeys('1120-3148')).toContain('11203148');
    expect(accountCodeLookupKeys('11100001')).toContain('1110-0001');
  });

  test('handles empty lookup and every legacy child-code ordering', () => {
    expect(accountCodeLookupKeys('')).toEqual([]);
    expect(nextChildAccountCode('1110', ['11100002', '4-1110', '1110-bad', 'other'])).toBe('1110-0005');
    expect(nextChildAccountCode('1110', ['11100002'])).toBe('1110-0003');
    expect(normalizeAccountCode(null)).toBe('');
    expect(normalizeAccountCode('11 10 - 0001')).toBe('1110-0001');
  });

  test('searches aliases in order and returns null when no account matches', async () => {
    const calls: string[] = [];
    const supabase = { from: () => {
      const api: any = { select: () => api, eq: (_field: string, value: string) => { if (_field === 'code') calls.push(value); return api; }, maybeSingle: async () => ({ data: calls.at(-1) === '1110-0001' ? { id: 'a1', code: '1110-0001' } : null }) };
      return api;
    } };
    await expect(findAccountByCode(supabase, 'c1', '0001-1110')).resolves.toMatchObject({ id: 'a1' });
    await expect(findAccountByCode({ from: () => { const api: any = { select: () => api, eq: () => api, maybeSingle: async () => ({ data: null }) }; return api; } }, 'c1', '9999')).resolves.toBeNull();
  });

  test('schema-like regex allows parent and child', () => {
    expect(ACCOUNT_CODE_RE.test('1110')).toBe(true);
    expect(ACCOUNT_CODE_RE.test('1110-0001')).toBe(true);
    expect(ACCOUNT_CODE_RE.test('1120-3148')).toBe(true);
    expect(ACCOUNT_CODE_RE.test('12ab')).toBe(false);
    expect(normalizeAccountCode(' 1110-0001 ')).toBe('1110-0001');
  });
});
