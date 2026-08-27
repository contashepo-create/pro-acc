/**
 * Unit tests for the construction accounting depth module (lib/construction.ts).
 * Covers WIP (over/under billing), retainage, change orders, equipment allocation.
 */
import {
  computeWip,
  computeRetainage,
  applyChangeOrder,
  allocateEquipmentCost,
} from '@/lib/construction';

describe('computeWip — percentage of completion', () => {
  test('computes %complete by cost and earned revenue', () => {
    const wip = computeWip({ contractAmount: 100000, costsIncurred: 25000, billedToDate: 20000 });
    expect(wip.percentComplete).toBeCloseTo(0.25, 5);
    expect(wip.earnedRevenue).toBeCloseTo(25000, 5);
    expect(wip.costToComplete).toBe(75000);
    expect(wip.estimatedProfit).toBe(75000);
  });

  test('flags under-billed when earned > billed', () => {
    const wip = computeWip({ contractAmount: 100000, costsIncurred: 50000, billedToDate: 30000 });
    expect(wip.overUnderBilled).toBeCloseTo(20000, 5);
    expect(wip.status).toBe('under-billed');
  });

  test('flags over-billed when billed > earned', () => {
    const wip = computeWip({ contractAmount: 100000, costsIncurred: 20000, billedToDate: 60000 });
    expect(wip.overUnderBilled).toBeCloseTo(-40000, 5);
    expect(wip.status).toBe('over-billed');
  });

  test('on-track when in balance', () => {
    const wip = computeWip({ contractAmount: 100000, costsIncurred: 50000, billedToDate: 50000 });
    expect(wip.status).toBe('on-track');
  });

  test('handles zero contract (no completion)', () => {
    const wip = computeWip({ contractAmount: 0, costsIncurred: 5000, billedToDate: 0 });
    expect(wip.percentComplete).toBe(0);
    expect(wip.earnedRevenue).toBe(0);
  });

  test('caps percentComplete at 1 and never goes negative', () => {
    const wip = computeWip({ contractAmount: 100, costsIncurred: 500, billedToDate: 0 });
    expect(wip.percentComplete).toBe(1);
    expect(wip.costToComplete).toBe(0);
  });

  test('clamps negative incurred costs and billings to zero', () => {
    expect(computeWip({ contractAmount: 100, costsIncurred: -10, billedToDate: -5 })).toMatchObject({ percentComplete: 0, earnedRevenue: 0, overUnderBilled: 0, costToComplete: 100 });
  });

  test('throws on negative contract amount', () => {
    expect(() => computeWip({ contractAmount: -1, costsIncurred: 0, billedToDate: 0 })).toThrow(RangeError);
  });
});

describe('computeRetainage', () => {
  test('retains a percentage of the billing', () => {
    const r = computeRetainage({ billingAmount: 10000, retainagePercent: 0.1 });
    expect(r.retainedThisCycle).toBeCloseTo(1000, 5);
    expect(r.netDue).toBeCloseTo(9000, 5);
    expect(r.totalRetained).toBeCloseTo(1000, 5);
    expect(r.capped).toBe(false);
  });

  test('respects a contract cap on cumulative retainage', () => {
    const r = computeRetainage({ billingAmount: 10000, retainagePercent: 0.1, priorRetained: 8000, retainageCap: 8500 });
    expect(r.retainedThisCycle).toBeCloseTo(500, 5);
    expect(r.totalRetained).toBeCloseTo(8500, 5);
    expect(r.capped).toBe(true);
    expect(r.netDue).toBeCloseTo(9500, 5);
  });

  test('clamps retainage percent to 0..1', () => {
    const r = computeRetainage({ billingAmount: 1000, retainagePercent: 2 });
    expect(r.retainedThisCycle).toBeCloseTo(1000, 5);
  });

  test('no retainage when percent is zero', () => {
    const r = computeRetainage({ billingAmount: 5000, retainagePercent: 0 });
    expect(r.retainedThisCycle).toBe(0);
    expect(r.netDue).toBe(5000);
  });
});

describe('applyChangeOrder', () => {
  test('increases contract value', () => {
    const r = applyChangeOrder({ baseContractAmount: 100000, changeAmount: 15000 });
    expect(r.newContractAmount).toBe(115000);
    expect(r.adjustedContractAmount).toBe(115000);
  });

  test('decreases contract value', () => {
    const r = applyChangeOrder({ baseContractAmount: 100000, changeAmount: -10000 });
    expect(r.newContractAmount).toBe(90000);
  });

  test('never lets contract fall below zero', () => {
    const r = applyChangeOrder({ baseContractAmount: 5000, changeAmount: -10000 });
    expect(r.newContractAmount).toBe(-5000);
    expect(r.adjustedContractAmount).toBe(0);
  });
});

describe('allocateEquipmentCost', () => {
  test('allocates cost weighted by usage hours', () => {
    const alloc = allocateEquipmentCost({ equipmentCost: 1000, usageHoursByProject: { a: 10, b: 30 } });
    expect(alloc.a).toBeCloseTo(250, 5);
    expect(alloc.b).toBeCloseTo(750, 5);
  });

  test('returns empty when no usage', () => {
    expect(allocateEquipmentCost({ equipmentCost: 1000, usageHoursByProject: {} })).toEqual({});
    expect(allocateEquipmentCost({ equipmentCost: 1000, usageHoursByProject: { a: 0 } })).toEqual({});
  });

  test('allocates all cost to the only project with usage', () => {
    const alloc = allocateEquipmentCost({ equipmentCost: 500, usageHoursByProject: { a: 0, b: 5 } });
    expect(alloc.b).toBeCloseTo(500, 5);
  });
});
