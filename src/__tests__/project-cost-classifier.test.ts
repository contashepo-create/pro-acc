import { classifyProjectCost, emptyProjectCostBucket } from '@/lib/project-cost-classifier';

describe('classifyProjectCost', () => {
  test('maps each canonical direct-cost account to the right category', () => {
    expect(classifyProjectCost('5110')).toBe('materials');
    expect(classifyProjectCost('5111')).toBe('materials'); // sub-account
    expect(classifyProjectCost('5120')).toBe('labor'); // direct labor
    expect(classifyProjectCost('5130')).toBe('subcontractor');
    expect(classifyProjectCost('5140')).toBe('equipment'); // equipment rental
  });

  test('maps operating expense accounts used for construction to labor/equipment', () => {
    expect(classifyProjectCost('5210')).toBe('labor'); // salaries
    expect(classifyProjectCost('5250')).toBe('equipment'); // maintenance
    expect(classifyProjectCost('5260')).toBe('equipment'); // depreciation
    expect(classifyProjectCost('5270')).toBe('equipment'); // fuel
  });

  test('falls back to other for general/admin and unrelated expense codes', () => {
    for (const code of ['5220', '5230', '5240', '5280', '5290', '5400', '5000', '9999', '']) {
      expect(classifyProjectCost(code)).toBe('other');
    }
  });

  test('empty bucket is zeroed for every category', () => {
    expect(emptyProjectCostBucket()).toEqual({
      materials: 0, labor: 0, subcontractor: 0, equipment: 0, other: 0,
    });
  });
});
