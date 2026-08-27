/**
 * Unit tests for the financial audit trail helper (lib/audit.ts).
 */
import { diffSummary } from '@/lib/audit';

describe('diffSummary', () => {
  test('shows changed fields with before → after', () => {
    const before = { id: '1', total: 100, status: 'draft' };
    const after = { id: '1', total: 150, status: 'approved' };
    const summary = diffSummary(before, after);
    expect(summary).toContain('total: 100 → 150');
    expect(summary).toContain('status: draft → approved');
    // unchanged id should not appear
    expect(summary).not.toContain('id:');
  });

  test('handles null before/after', () => {
    expect(diffSummary(null, { amount: 5 })).toContain('amount: ∅ → 5');
    expect(diffSummary({ amount: 5 }, null)).toContain('amount: 5 → ∅');
    expect(diffSummary(null, null)).toBe('');
  });

  test('treats numeric-equivalent strings as unchanged', () => {
    const summary = diffSummary({ total: 100 }, { total: '100' });
    expect(summary).toBe('');
  });
});
