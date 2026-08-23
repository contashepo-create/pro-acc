import type { Row } from './types';

/**
 * Overhead (indirect cost) allocation for project costing.
 *
 * Mirrors international construction-accounting practice (Sage 300 CRE,
 * QuickBooks for Contractors, NetSuite job costing, Viewpoint): indirect
 * costs that cannot be traced to one job are spread across projects using a
 * rational allocation base and a rate. The two most common bases are:
 *   - 'direct_cost'  -> allocated = rate x project's total direct cost
 *   - 'direct_labor' -> allocated = rate x project's direct labour cost
 *
 * Allocated overhead is always reported SEPARATELY from direct costs, so the
 * system shows both "direct profit" and "profit after overhead".
 */

export type OverheadAllocationBasis = 'direct_cost' | 'direct_labor';

export const OVERHEAD_BASIS: Set<string> = new Set(['direct_cost', 'direct_labor']);

/** Name used to build the rate in the UI (percent). */
export const basisLabel = (basis: OverheadAllocationBasis) =>
  basis === 'direct_labor' ? 'نسبة من تكلفة العمالة المباشرة' : 'نسبة من التكلفة المباشرة';

/**
 * Validate an overhead-rule payload (create/update). Returns either a
 * normalized object of provided fields or an Arabic error string.
 */
export function validateOverheadRule(body: Row):
  | { name?: string; basis?: string; rate?: number; active?: boolean }
  | string {
  if (body.name !== undefined && (typeof body.name !== 'string' || !body.name.trim() || body.name.trim().length > 100)) {
    return 'اسم قاعدة التخصيص غير صالح';
  }
  if (body.allocation_basis !== undefined && !OVERHEAD_BASIS.has(String(body.allocation_basis))) {
    return 'أساس التخصيص غير صالح';
  }
  if (body.rate !== undefined) {
    const rate = Number(body.rate);
    if (!Number.isFinite(rate) || rate < 0 || rate > 1 || Math.abs(rate * 10000 - Math.round(rate * 10000)) > 1e-8) {
      return 'نسبة التخصيص غير صالحة (0 إلى 1)';
    }
  }
  if (body.is_active !== undefined && typeof body.is_active !== 'boolean') {
    return 'حالة القاعدة غير صالحة';
  }
  return {
    name: body.name == null ? undefined : String(body.name),
    basis: body.allocation_basis == null ? undefined : String(body.allocation_basis),
    rate: body.rate == null ? undefined : Number(body.rate),
    active: body.is_active == null ? undefined : Boolean(body.is_active),
  };
}

export interface OverheadAllocationRule {
  id: string;
  name: string;
  allocationBasis: OverheadAllocationBasis;
  rate: number; // 0..1
  isActive: boolean;
}

export interface ProjectCostBase {
  projectId: string;
  directCost: number;   // total direct cost recognised on the ledger
  directLabor: number;  // direct-labour portion of directCost
}

export interface ProjectOverheadResult extends ProjectCostBase {
  allocatedOverhead: number; // sum over active rules of rate x basis
}

const round2 = (n: number) => Math.round((n + Number.EPSILON) * 100) / 100;

/** Allocate overhead across projects from the active rules and their bases. */
export function allocateOverhead(
  costs: ProjectCostBase[],
  rules: OverheadAllocationRule[],
): ProjectOverheadResult[] {
  const active = (rules || []).filter((r) => r.isActive);
  return (costs || []).map((c) => {
    const base = c.directCost;
    const labor = c.directLabor;
    const allocated = active.reduce((sum, r) => {
      const basis = r.allocationBasis === 'direct_labor' ? labor : base;
      return sum + (r.rate || 0) * basis;
    }, 0);
    return {
      ...c,
      allocatedOverhead: round2(allocated),
    };
  });
}

/** Total allocated overhead across a set of projects (for a summary row). */
export function sumAllocatedOverhead(results: ProjectOverheadResult[]): number {
  return round2((results || []).reduce((s, r) => s + (r.allocatedOverhead || 0), 0));
}
