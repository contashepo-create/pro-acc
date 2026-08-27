process.env.TOKEN_SECRET = 'test-secret-key-for-unit-tests-32chars!';

import type { NextRequest } from 'next/server';
import { HEADER_ACCOUNT_CODES, isHeaderAccount, isCashOrBankCode } from '@/lib/account-resolve';
import { GET as diagnosticsGET } from '@/app/api/diagnostics/route';
import { GET as cleanupGET } from '@/app/api/auth/cleanup-inactive/route';

describe('Chart header / cash-bank helpers', () => {
  test('group accounts are headers and cash/bank codes are recognized', () => {
    expect(HEADER_ACCOUNT_CODES.has('1000')).toBe(true);
    expect(HEADER_ACCOUNT_CODES.has('1110')).toBe(false);
    expect(isHeaderAccount({ code: '1000' })).toBe(true);
    expect(isHeaderAccount({ code: '1110', is_header: false })).toBe(false);
    expect(isHeaderAccount({ code: '1110', children: [{ id: 1 }] })).toBe(true);
    expect(isCashOrBankCode('1110')).toBe(true);
    expect(isCashOrBankCode('1110-0001')).toBe(true);
    expect(isCashOrBankCode('1130')).toBe(false);
  });
});

describe('Diagnostics is no longer public', () => {
  test('anonymous GET is 401', async () => {
    const res = await diagnosticsGET({
      headers: { get: () => null },
      cookies: { get: () => undefined },
    } as unknown as NextRequest);
    expect(res.status).toBe(401);
  });
});

describe('cleanup-inactive refuses an unset secret', () => {
  const prev = process.env.CRON_SECRET;
  afterEach(() => {
    if (prev === undefined) delete process.env.CRON_SECRET;
    else process.env.CRON_SECRET = prev;
  });

  test('missing CRON_SECRET → 401 even with a header', async () => {
    delete process.env.CRON_SECRET;
    const res = await cleanupGET({
      headers: { get: (k: string) => (k === 'x-cron-secret' ? 'anything' : null) },
    } as unknown as NextRequest);
    expect(res.status).toBe(401);
    const json = await res.json();
    expect(json.message).toMatch(/CRON_SECRET|غير مصرح/);
  });

  test('wrong secret → 401', async () => {
    process.env.CRON_SECRET = 'expected-secret-value-32chars!!!!';
    const res = await cleanupGET({
      headers: { get: (k: string) => (k === 'x-cron-secret' ? 'wrong-secret-value-32chars!!!!!!' : null) },
    } as unknown as NextRequest);
    expect(res.status).toBe(401);
  });
});
