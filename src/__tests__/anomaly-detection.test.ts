/**
 * Unit tests for heuristic anomaly detection (lib/analytics/anomaly.ts).
 */
import {
  detectDuplicateInvoices,
  detectOutliers,
  detectSpendingSpikes,
  detectInvalidValues,
} from '@/lib/analytics/anomaly';

describe('detectDuplicateInvoices', () => {
  test('flags identical amounts for the same party within the window', () => {
    const findings = detectDuplicateInvoices([
      { id: 'a', contact_id: 'c1', amount: 1000, date: '2026-01-01' },
      { id: 'b', contact_id: 'c1', amount: 1000, date: '2026-01-10' },
    ]);
    expect(findings).toHaveLength(1);
    expect(findings[0].code).toBe('DUPLICATE_INVOICE');
    expect(findings[0].severity).toBe('medium');
  });

  test('does not flag different amounts or parties', () => {
    const findings = detectDuplicateInvoices([
      { id: 'a', contact_id: 'c1', amount: 1000, date: '2026-01-01' },
      { id: 'b', contact_id: 'c1', amount: 2000, date: '2026-01-10' },
      { id: 'c', contact_id: 'c2', amount: 1000, date: '2026-01-10' },
    ]);
    expect(findings).toHaveLength(0);
  });

  test('does not flag invoices outside the window', () => {
    const findings = detectDuplicateInvoices([
      { id: 'a', contact_id: 'c1', amount: 1000, date: '2026-01-01' },
      { id: 'b', contact_id: 'c1', amount: 1000, date: '2026-05-01' }, // > 30 days
    ]);
    expect(findings).toHaveLength(0);
  });

  test('treats missing party as distinct (no false positive)', () => {
    const findings = detectDuplicateInvoices([
      { id: 'a', contact_id: null, amount: 500, date: '2026-01-01' },
      { id: 'b', contact_id: null, amount: 500, date: '2026-01-05' },
    ]);
    expect(findings).toHaveLength(0);
  });
});

describe('detectOutliers', () => {
  test('flags a value well above the median', () => {
    const findings = detectOutliers(
      [{ id: 'a', amount: 10 }, { id: 'b', amount: 12 }, { id: 'c', amount: 11 }, { id: 'd', amount: 1000 }],
      5
    );
    expect(findings).toHaveLength(1);
    expect(findings[0].code).toBe('OUTLIER_AMOUNT');
    expect(findings[0].refId).toBe('d');
  });

  test('returns nothing for too few samples', () => {
    expect(detectOutliers([{ id: 'a', amount: 10 }, { id: 'b', amount: 1000 }])).toHaveLength(0);
  });

  test('returns nothing when no outliers', () => {
    const findings = detectOutliers(
      [{ amount: 100 }, { amount: 101 }, { amount: 99 }, { amount: 102 }, { amount: 103 }], 5
    );
    expect(findings).toHaveLength(0);
  });
});

describe('detectSpendingSpikes', () => {
  test('flags a month with a large jump over the prior', () => {
    const findings = detectSpendingSpikes([
      { period: '2026-01', amount: 100 },
      { period: '2026-02', amount: 2000 },
    ], 3);
    expect(findings).toHaveLength(1);
    expect(findings[0].code).toBe('SPENDING_SPIKE');
    expect(findings[0].severity).toBe('high');
  });

  test('ignores small prior baselines to avoid false spikes', () => {
    const findings = detectSpendingSpikes([
      { period: '2026-01', amount: 0 },
      { period: '2026-02', amount: 500 },
    ], 3);
    expect(findings).toHaveLength(0);
  });
});

describe('detectInvalidValues', () => {
  test('flags negative values', () => {
    const findings = detectInvalidValues([{ id: 'x', label: 'رصيد نقدي', value: -5 }]);
    expect(findings).toHaveLength(1);
    expect(findings[0].code).toBe('NEGATIVE_VALUE');
  });

  test('flags non-finite values', () => {
    const findings = detectInvalidValues([{ id: 'y', label: 'كمية', value: NaN }]);
    expect(findings).toHaveLength(1);
    expect(findings[0].code).toBe('NON_FINITE');
  });

  test('accepts valid values', () => {
    expect(detectInvalidValues([{ id: 'z', label: 'إيراد', value: 100 }])).toHaveLength(0);
  });
});
