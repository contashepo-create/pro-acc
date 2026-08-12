import { resolveLineAccountId } from '@/lib/report-journal';

describe('report line → account resolution', () => {
  test('prefers account_id when it exists on the chart', () => {
    const byId = new Set(['a1']);
    const byCode = new Map([['1110-0001', 'a1']]);
    expect(resolveLineAccountId({ account_id: 'a1', account_code: 'x' }, byId, byCode)).toBe('a1');
  });

  test('falls back to account_code when id is missing (legacy lines)', () => {
    const byId = new Set(['a1']);
    const byCode = new Map([['1110-0001', 'a1']]);
    expect(resolveLineAccountId({ account_id: null, account_code: '1110-0001' }, byId, byCode)).toBe('a1');
  });
});
