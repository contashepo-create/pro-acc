/**
 * Canonical project-cost categorization.
 *
 * The default chart of accounts puts all construction cost accounts under two
 * headers:
 *   5100 Direct costs → 5110 materials, 5120 direct labor,
 *                       5130 subcontractors, 5140 equipment rental
 *   5200 Operating     → 5210 salaries, 5220 rent, 5230 utilities,
 *                       5250 maintenance, 5260 depreciation, 5270 fuel, …
 *   5400 General & admin
 *
 * Historically every report re-implemented its own (inconsistent) prefix
 * matching — e.g. labor entered via account 5120 was shown under "other" or
 * even under "equipment". This module is the single source of truth so all
 * reports classify a given expense account identically.
 *
 * Normalizing on the first three digits is deliberate: sub-accounts like
 * 5111/5112 all belong to "materials".
 */
export type ProjectCostCategory = 'materials' | 'labor' | 'subcontractor' | 'equipment' | 'other';

export function classifyProjectCost(code: string): ProjectCostCategory {
  const c = String(code || '');
  // Materials: 5110, 5111, …
  if (c.startsWith('511')) return 'materials';
  // Direct labor (5120) + salaries (5210) are both labor.
  if (c.startsWith('512') || c.startsWith('521')) return 'labor';
  // Subcontractor costs: 5130
  if (c.startsWith('513')) return 'subcontractor';
  // Equipment: rental (5140), maintenance (5250), depreciation (5260), fuel (5270).
  if (c.startsWith('514') || c.startsWith('525') || c.startsWith('526') || c.startsWith('527')) return 'equipment';
  // Everything else (rent, utilities, communication, stationery, bank charges,
  // general & admin 5400, unclassified) is "other".
  return 'other';
}

export const PROJECT_COST_CATEGORY_LABELS: Record<ProjectCostCategory, string> = {
  materials: 'المواد',
  labor: 'العمالة',
  subcontractor: 'مقاولو الباطن',
  equipment: 'المعدات',
  other: 'مصروفات أخرى',
};

/** Returns a zeroed cost bucket keyed by category. */
export function emptyProjectCostBucket(): Record<ProjectCostCategory, number> {
  return { materials: 0, labor: 0, subcontractor: 0, equipment: 0, other: 0 };
}
