/**
 * Construction accounting depth — pure domain logic.
 *
 * Provides computation helpers for the construction-specific capabilities
 * that set dedicated contractor software (Sage 300 CRE, Viewpoint, CMiC)
 * apart from generic ledgers:
 *
 *  1. WIP — Work In Progress (over / under billing)
 *  2. Retainage — amounts held back from billings/contracts
 *  3. Change Orders — contract amendments and their effect on budget
 *  4. Equipment cost allocation onto projects
 *
 * All functions are pure and unit-testable; they do not touch the DB.
 */

export interface WipInput {
  /** Total value of the signed contract(s) for the project. */
  contractAmount: number;
  /** Costs actually incurred so far (labour, material, equipment, subs). */
  costsIncurred: number;
  /** Total billed to the owner so far (including VAT-exclusive amounts). */
  billedToDate: number;
}

export interface WipResult {
  /** Percentage of completion based on cost. 0..1 (capped, never negative). */
  percentComplete: number;
  /** Revenue recognized under percentage-of-completion = contract × %complete. */
  earnedRevenue: number;
  /** Revenue earned but not yet billed (or over-billed if negative). */
  overUnderBilled: number;
  /** Cost remaining to complete = contract - costsIncurred (>= 0). */
  costToComplete: number;
  /** Estimated remaining profit = contract - costsIncurred. */
  estimatedProfit: number;
  status: 'over-billed' | 'under-billed' | 'on-track';
}

/**
 * Compute WIP (Work In Progress) per percentage-of-completion.
 *
 * @param input contract + cost + billing figures.
 * @throws RangeError if contractAmount is negative.
 */
export function computeWip(input: WipInput): WipResult {
  if (input.contractAmount < 0) {
    throw new RangeError('contractAmount must be non-negative');
  }
  if (input.costsIncurred < 0) input = { ...input, costsIncurred: 0 };
  if (input.billedToDate < 0) input = { ...input, billedToDate: 0 };

  const contract = input.contractAmount;
  // Percent complete measured by cost; contract with no value → 0%.
  const percentComplete =
    contract > 0 ? Math.min(1, Math.max(0, input.costsIncurred / contract)) : 0;

  const earnedRevenue = contract * percentComplete;
  const overUnderBilled = earnedRevenue - input.billedToDate;

  const costToComplete = Math.max(0, contract - input.costsIncurred);
  const estimatedProfit = contract - input.costsIncurred;

  let status: WipResult['status'] = 'on-track';
  if (overUnderBilled < -0.005) status = 'over-billed';
  else if (overUnderBilled > 0.005) status = 'under-billed';

  return {
    percentComplete,
    earnedRevenue,
    overUnderBilled,
    costToComplete,
    estimatedProfit,
    status,
  };
}

/**
 * Retainage — percentage of each billing held back as a guarantee, released
 * later (typically on project completion / defect-liability expiry).
 */
export interface RetainageInput {
  /** Billed amount for this billing cycle (VAT-exclusive). */
  billingAmount: number;
  /** Retainage percentage, e.g. 0.1 for 10%. */
  retainagePercent: number;
  /** Retainage already retained on previous billings. */
  priorRetained?: number;
  /** Contract cap on total retainage (optional). */
  retainageCap?: number;
}

export interface RetainageResult {
  /** Amount retained this cycle. */
  retainedThisCycle: number;
  /** Cumulative retained so far. */
  totalRetained: number;
  /** Net amount payable/collectible this cycle. */
  netDue: number;
  /** True when the contract retainage cap is reached. */
  capped: boolean;
}

export function computeRetainage(input: RetainageInput): RetainageResult {
  const percent = Math.min(1, Math.max(0, input.retainagePercent));
  const grossRetained = input.billingAmount * percent;
  const prior = input.priorRetained || 0;

  let retainedThisCycle = grossRetained;
  let capped = false;
  if (input.retainageCap != null) {
    const room = Math.max(0, input.retainageCap - prior);
    if (retainedThisCycle > room) {
      retainedThisCycle = room;
      // Once the requested retainage exceeds the remaining room, the cap is
      // reached by definition; the previous duplicate comparisons were always true.
      capped = true;
    }
  }

  const totalRetained = prior + retainedThisCycle;
  const netDue = input.billingAmount - retainedThisCycle;
  return { retainedThisCycle, totalRetained, netDue, capped };
}

/**
 * Change Order — an approved amendment to a contract that adjusts its value
 * and/or scope, and consequently the project budget and WIP.
 */
export interface ChangeOrderInput {
  /** Contract value before the change. */
  baseContractAmount: number;
  /** Net value of the change order (positive = increase, negative = decrease). */
  changeAmount: number;
  /** Costs already incurred that relate only to the changed scope. */
  relatedCosts?: number;
}

export interface ChangeOrderResult {
  /** Updated contract amount after applying the change. */
  newContractAmount: number;
  /** Contract value never allowed below zero. */
  adjustedContractAmount: number;
}

export function applyChangeOrder(input: ChangeOrderInput): ChangeOrderResult {
  const newContractAmount = input.baseContractAmount + input.changeAmount;
  const adjustedContractAmount = Math.max(0, newContractAmount);
  return { newContractAmount, adjustedContractAmount };
}

/**
 * Equipment cost allocation — apportion a piece of equipment's cost across
 * the projects that used it, weighted by usage hours, to load true job costs.
 */
export interface EquipmentAllocationInput {
  /** Total cost incurred for the equipment in the period (e.g. rental + fuel). */
  equipmentCost: number;
  /** Usage hours per project, e.g. { projectA: 10, projectB: 30 }. */
  usageHoursByProject: Record<string, number>;
}

export function allocateEquipmentCost(input: EquipmentAllocationInput): Record<string, number> {
  const entries = Object.entries(input.usageHoursByProject).filter(([, h]) => h > 0);
  const totalHours = entries.reduce((s, [, h]) => s + h, 0);
  if (totalHours <= 0) return {};
  const out: Record<string, number> = {};
  for (const [proj, hours] of entries) {
    out[proj] = (input.equipmentCost * hours) / totalHours;
  }
  return out;
}
