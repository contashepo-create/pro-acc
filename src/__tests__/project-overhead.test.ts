import { allocateOverhead, sumAllocatedOverhead, validateOverheadRule, basisLabel, type OverheadAllocationRule , type ProjectOverheadResult } from '@/lib/project-overhead';

describe('allocateOverhead', () => {
  const rules: OverheadAllocationRule[] = [
    { id: 'r1', name: 'OH cost', allocationBasis: 'direct_cost', rate: 0.10, isActive: true },
    { id: 'r2', name: 'OH labor', allocationBasis: 'direct_labor', rate: 0.20, isActive: true },
  ];

  test('allocates overhead on direct cost and direct labor bases', () => {
    const costs = [{ projectId: 'p1', directCost: 300, directLabor: 100 }];
    const result = allocateOverhead(costs, rules);
    // 0.10*300 + 0.20*100 = 30 + 20 = 50
    expect(result[0].allocatedOverhead).toBe(50);
  });

  test('direct_labor rules base only on labour, not total direct cost', () => {
    const laborOnly: OverheadAllocationRule[] = [
      { id: 'r', name: 'labor burden', allocationBasis: 'direct_labor', rate: 0.5, isActive: true },
    ];
    const result = allocateOverhead([{ projectId: 'p1', directCost: 1000, directLabor: 200 }], laborOnly);
    // 0.5 * 200 = 100 (NOT 0.5 * 1000)
    expect(result[0].allocatedOverhead).toBe(100);
  });

  test('ignores inactive rules', () => {
    const inactive: OverheadAllocationRule[] = [
      { id: 'r1', name: 'a', allocationBasis: 'direct_cost', rate: 0.10, isActive: false },
    ];
    const result = allocateOverhead([{ projectId: 'p1', directCost: 1000, directLabor: 0 }], inactive);
    expect(result[0].allocatedOverhead).toBe(0);
  });

  test('returns zeros for empty cost sets', () => {
    expect(allocateOverhead([], rules)).toEqual([]);
  });

  test('rounds to two decimals', () => {
    const result = allocateOverhead([{ projectId: 'p1', directCost: 33.33, directLabor: 0 }], rules);
    expect(result[0].allocatedOverhead).toBe(3.33);
  });

  test('handles a zero rate (rate || 0 branch)', () => {
    const zeroRate: OverheadAllocationRule[] = [
      { id: 'r', name: 'z', allocationBasis: 'direct_cost', rate: 0, isActive: true },
    ];
    const result = allocateOverhead([{ projectId: 'p1', directCost: 1000, directLabor: 0 }], zeroRate);
    expect(result[0].allocatedOverhead).toBe(0);
  });

  test('treats null/undefined rules and costs as empty', () => {
    expect(allocateOverhead(null, null)).toEqual([]);
    expect(allocateOverhead(null, null)).toEqual([]);
    // No rules → zero allocation but per-project rows preserved.
    const noRules = allocateOverhead([{ projectId: 'p1', directCost: 100, directLabor: 0 }], null);
    expect(noRules).toHaveLength(1);
    expect(noRules[0].allocatedOverhead).toBe(0);
  });
});

describe('sumAllocatedOverhead', () => {
  test('sums across projects', () => {
    const results = [
      { projectId: 'a', directCost: 0, directLabor: 0, allocatedOverhead: 10 },
      { projectId: 'b', directCost: 0, directLabor: 0, allocatedOverhead: 20.5 },
    ];
    expect(sumAllocatedOverhead(results)).toBe(30.5);
  });

  test('returns 0 for null/undefined/empty input and tolerates missing allocatedOverhead', () => {
    expect(sumAllocatedOverhead(null)).toBe(0);
    expect(sumAllocatedOverhead(null)).toBe(0);
    expect(sumAllocatedOverhead([])).toBe(0);
    expect(sumAllocatedOverhead([{ projectId: 'x' } as unknown as ProjectOverheadResult])).toBe(0);
  });
});

describe('basisLabel', () => {
  test('returns the labour label for direct_labor and cost label otherwise', () => {
    expect(basisLabel('direct_labor')).toBe('نسبة من تكلفة العمالة المباشرة');
    expect(basisLabel('direct_cost')).toBe('نسبة من التكلفة المباشرة');
  });
});

describe('validateOverheadRule', () => {
  test('accepts a valid create payload', () => {
    const out = validateOverheadRule({ name: 'OH', allocation_basis: 'direct_cost', rate: 0.1, is_active: true });
    expect(out).toEqual({ name: 'OH', basis: 'direct_cost', rate: 0.1, active: true });
  });

  test('rejects an out-of-range rate and unknown basis', () => {
    expect(typeof validateOverheadRule({ rate: 1.5 })).toBe('string');
    expect(typeof validateOverheadRule({ allocation_basis: 'foo' })).toBe('string');
    expect(typeof validateOverheadRule({ name: '' })).toBe('string');
  });

  test('rejects a non-boolean is_active and an over-long name', () => {
    expect(typeof validateOverheadRule({ is_active: 'yes' })).toBe('string');
    expect(typeof validateOverheadRule({ name: 'x'.repeat(101) })).toBe('string');
  });

  test('accepts partial update payloads (no required fields)', () => {
    expect(validateOverheadRule({ rate: 0.05 })).toEqual({ name: undefined, basis: undefined, rate: 0.05, active: undefined });
    expect(validateOverheadRule({ is_active: false })).toEqual({ name: undefined, basis: undefined, rate: undefined, active: false });
  });

  test('rejects NaN rate and a rate with more than 4 decimals', () => {
    expect(typeof validateOverheadRule({ rate: NaN })).toBe('string');
    expect(typeof validateOverheadRule({ rate: 0.12345 })).toBe('string');
  });
});
