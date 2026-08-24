/**
 * Tests for account resolution logic — header detection and cash/bank code matching.
 * Pure functions (no DB calls needed for the synchronous helpers).
 */

import { isHeaderAccount, isCashOrBankCode, HEADER_ACCOUNT_CODES } from '@/lib/account-resolve';

describe('isHeaderAccount', () => {
  test('returns true for explicitly marked header accounts', () => {
    expect(isHeaderAccount({ is_header: true })).toBe(true);
    expect(isHeaderAccount({ code: '9999', is_header: true })).toBe(true);
  });

  test('returns true for accounts with children', () => {
    expect(isHeaderAccount({ children: [{ id: '1' }] })).toBe(true);
    expect(isHeaderAccount({ children: [{}, {}] })).toBe(true);
  });

  test('returns false for accounts with empty children array', () => {
    expect(isHeaderAccount({ children: [] })).toBe(false);
  });

  test('returns true for well-known header account codes', () => {
    const expectedHeaders = [
      '1000', '1100', '1200', // assets
      '2000', '2100', '2200', // liabilities
      '3000',                  // equity
      '4000',                  // revenue
      '5000', '5100', '5200', // expenses
    ];
    for (const code of expectedHeaders) {
      expect(isHeaderAccount({ code })).toBe(true);
    }
  });

  test('returns false for leaf account codes', () => {
    const leafCodes = ['1110', '1130', '2120', '4100', '5110'];
    for (const code of leafCodes) {
      expect(isHeaderAccount({ code })).toBe(false);
    }
  });

  test('returns false for null/undefined input', () => {
    expect(isHeaderAccount({})).toBe(false);
    expect(isHeaderAccount({ code: null })).toBe(false);
  });

  test('HEADER_ACCOUNT_CODES set has expected size', () => {
    expect(HEADER_ACCOUNT_CODES.size).toBe(11);
  });
});

describe('isCashOrBankCode', () => {
  test('identifies primary cash code 1110', () => {
    expect(isCashOrBankCode('1110')).toBe(true);
  });

  test('identifies primary bank code 1120', () => {
    expect(isCashOrBankCode('1120')).toBe(true);
  });

  test('identifies sub-codes with dash prefix', () => {
    expect(isCashOrBankCode('1110-001')).toBe(true);
    expect(isCashOrBankCode('1120-002')).toBe(true);
  });

  test('identifies sub-codes with dash suffix', () => {
    expect(isCashOrBankCode('001-1110')).toBe(true);
    expect(isCashOrBankCode('002-1120')).toBe(true);
  });

  test('identifies 8-digit extended codes', () => {
    expect(isCashOrBankCode('11100001')).toBe(true);
    expect(isCashOrBankCode('11200001')).toBe(true);
  });

  test('rejects non-cash/bank codes', () => {
    expect(isCashOrBankCode('1130')).toBe(false);
    expect(isCashOrBankCode('4100')).toBe(false);
    expect(isCashOrBankCode('2120')).toBe(false);
    expect(isCashOrBankCode('1111')).toBe(false);
  });

  test('rejects null/undefined/empty', () => {
    expect(isCashOrBankCode(null)).toBe(false);
    expect(isCashOrBankCode(undefined)).toBe(false);
    expect(isCashOrBankCode('')).toBe(false);
  });
});
