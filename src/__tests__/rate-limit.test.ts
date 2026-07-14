/**
 * Tests for lib/rate-limit.ts - IP sanitization and rate limiting
 */

let capturedFilter = '';
let mockAttemptsData: any[] | null = [];
let mockAttemptsError: any = null;

jest.mock('../lib/supabase-client', () => ({
  getSupabase: () => ({
    from: () => ({
      select: () => ({
        or: (filter: string) => {
          capturedFilter = filter;
          return {
            eq: () => ({
              gte: () => ({
                order: () => Promise.resolve({ data: mockAttemptsData, error: mockAttemptsError }),
              }),
            }),
          };
        },
      }),
    }),
  }),
}));

import { checkRateLimit } from '../lib/rate-limit';

describe('IP Address Sanitization', () => {
  beforeEach(() => {
    capturedFilter = '';
    mockAttemptsData = [];
    mockAttemptsError = null;
  });

  test('should accept valid IPv4 address', async () => {
    await checkRateLimit('test@example.com', '192.168.1.1');
    expect(capturedFilter).toContain('ip_address.eq.192.168.1.1');
  });

  test('should accept valid IPv4 loopback', async () => {
    await checkRateLimit('test@example.com', '127.0.0.1');
    expect(capturedFilter).toContain('ip_address.eq.127.0.0.1');
  });

  test('should reject PostgREST injection via comma', async () => {
    await checkRateLimit('test@example.com', '1.2.3.4,ip_address.eq.anything');
    expect(capturedFilter).toContain('ip_address.eq.unknown');
    expect(capturedFilter).not.toContain('anything');
  });

  test('should reject IP with parentheses injection', async () => {
    await checkRateLimit('test@example.com', '1.2.3.4).or(email.eq.hack)');
    expect(capturedFilter).toContain('ip_address.eq.unknown');
  });

  test('should handle "unknown" IP gracefully', async () => {
    await checkRateLimit('test@example.com', 'unknown');
    expect(capturedFilter).toContain('ip_address.eq.unknown');
  });

  test('should handle empty IP', async () => {
    await checkRateLimit('test@example.com', '');
    expect(capturedFilter).toContain('ip_address.eq.unknown');
  });

  test('should reject out-of-range IPv4', async () => {
    await checkRateLimit('test@example.com', '999.999.999.999');
    expect(capturedFilter).toContain('ip_address.eq.unknown');
  });

  test('should accept valid IPv6 loopback', async () => {
    await checkRateLimit('test@example.com', '::1');
    expect(capturedFilter).toContain('ip_address.eq.::1');
  });
});

describe('Rate Limiting Logic', () => {
  beforeEach(() => {
    capturedFilter = '';
    mockAttemptsData = [];
    mockAttemptsError = null;
  });

  test('should allow login with no previous attempts', async () => {
    const result = await checkRateLimit('user@test.com', '10.0.0.1');
    expect(result.allowed).toBe(true);
    expect(result.remainingMinutes).toBe(0);
  });

  test('should block after 5 failed attempts', async () => {
    const now = Date.now();
    mockAttemptsData = Array.from({ length: 5 }, (_, i) => ({
      attempted_at: new Date(now - (5 - i) * 60000).toISOString(),
    }));
    
    const result = await checkRateLimit('user@test.com', '10.0.0.1');
    expect(result.allowed).toBe(false);
    expect(result.remainingMinutes).toBeGreaterThan(0);
  });

  test('should be fail-open when database errors', async () => {
    mockAttemptsError = new Error('Connection refused');
    mockAttemptsData = null;
    
    const result = await checkRateLimit('user@test.com', '10.0.0.1');
    expect(result.allowed).toBe(true);
    expect(result.remainingMinutes).toBe(0);
  });
});
