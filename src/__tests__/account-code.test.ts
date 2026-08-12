import {
  accountCodeLookupKeys,
  nextChildAccountCode,
  normalizeAccountCode,
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

  test('schema-like regex allows parent and child', () => {
    expect(ACCOUNT_CODE_RE.test('1110')).toBe(true);
    expect(ACCOUNT_CODE_RE.test('1110-0001')).toBe(true);
    expect(ACCOUNT_CODE_RE.test('1120-3148')).toBe(true);
    expect(ACCOUNT_CODE_RE.test('12ab')).toBe(false);
    expect(normalizeAccountCode(' 1110-0001 ')).toBe('1110-0001');
  });
});
