import { passesOriginCheck, isCsrfExemptPath } from '@/lib/csrf-origin';

const base = {
  pathname: '/api/invoices',
  requestHost: 'app.example.com',
  origin: null as string | null,
  referer: null as string | null,
};

describe('CSRF origin verification (proxy layer)', () => {
  it('always allows safe methods', () => {
    for (const method of ['GET', 'HEAD', 'OPTIONS', 'get']) {
      expect(
        passesOriginCheck({ ...base, method, origin: 'https://evil.example' })
      ).toBe(true);
    }
  });

  it('allows same-origin POST (Origin matches host)', () => {
    expect(
      passesOriginCheck({ ...base, method: 'POST', origin: 'https://app.example.com' })
    ).toBe(true);
  });

  it('blocks cross-origin POST (classic CSRF)', () => {
    expect(
      passesOriginCheck({ ...base, method: 'POST', origin: 'https://evil.example' })
    ).toBe(false);
  });

  it('blocks cross-origin DELETE and PUT', () => {
    expect(
      passesOriginCheck({ ...base, method: 'DELETE', origin: 'https://evil.example' })
    ).toBe(false);
    expect(
      passesOriginCheck({ ...base, method: 'PUT', origin: 'http://app.example.com.evil.tld' })
    ).toBe(false);
  });

  it('blocks the literal "null" origin (sandboxed iframe / data: URL)', () => {
    expect(passesOriginCheck({ ...base, method: 'POST', origin: 'null' })).toBe(false);
  });

  it('blocks malformed Origin header', () => {
    expect(passesOriginCheck({ ...base, method: 'POST', origin: '::::not-a-url' })).toBe(false);
  });

  it('falls back to Referer when Origin is absent', () => {
    expect(
      passesOriginCheck({
        ...base,
        method: 'POST',
        referer: 'https://app.example.com/dashboard/invoices',
      })
    ).toBe(true);
    expect(
      passesOriginCheck({ ...base, method: 'POST', referer: 'https://evil.example/attack.html' })
    ).toBe(false);
  });

  it('allows non-browser requests (no Origin, no Referer) — curl/webhooks/tests', () => {
    expect(passesOriginCheck({ ...base, method: 'POST' })).toBe(true);
  });

  it('port must match too (host includes port)', () => {
    expect(
      passesOriginCheck({
        ...base,
        requestHost: 'localhost:3000',
        method: 'POST',
        origin: 'http://localhost:3000',
      })
    ).toBe(true);
    expect(
      passesOriginCheck({
        ...base,
        requestHost: 'localhost:3000',
        method: 'POST',
        origin: 'http://localhost:4000',
      })
    ).toBe(false);
  });

  it('host comparison is case-insensitive', () => {
    expect(
      passesOriginCheck({
        ...base,
        requestHost: 'App.Example.com',
        method: 'POST',
        origin: 'https://app.example.COM',
      })
    ).toBe(true);
  });

  it('exempts server-to-server webhook paths', () => {
    expect(isCsrfExemptPath('/api/telegram/webhook')).toBe(true);
    expect(isCsrfExemptPath('/api/telegram/callback')).toBe(true);
    expect(isCsrfExemptPath('/api/invoices')).toBe(false);
    expect(
      passesOriginCheck({
        method: 'POST',
        pathname: '/api/telegram/webhook',
        origin: 'https://evil.example',
        referer: null,
        requestHost: 'app.example.com',
      })
    ).toBe(true);
  });
});
