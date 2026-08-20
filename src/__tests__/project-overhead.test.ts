import { allocateOverhead, sumAllocatedOverhead, validateOverheadRule, type OverheadAllocationRule } from '@/lib/project-overhead';

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
});

describe('sumAllocatedOverhead', () => {
  test('sums across projects', () => {
    const results = [
      { projectId: 'a', directCost: 0, directLabor: 0, allocatedOverhead: 10 },
      { projectId: 'b', directCost: 0, directLabor: 0, allocatedOverhead: 20.5 },
    ];
    expect(sumAllocatedOverhead(results)).toBe(30.5);
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
});
