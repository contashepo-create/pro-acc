import { getSupabase } from '@/lib/supabase-client';

const sb = () => getSupabase();

/**
 * Usage limits for the new three-tier pricing model.
 * Kept as a standalone module so routes that are still on the older
 * checkUsageLimit helper keep working transparently.
 */

export interface PlanLimits {
  planCode: string | null;
  max_users: number;
  max_clients: number | null;
  max_suppliers: number | null;
  max_employees: number | null;
  max_projects: number | null;
  max_invoices_per_month: number | null;
  max_quotations_per_month: number | null;
  max_storage_mb: number;
  features_modules: Record<string, boolean>;
  extra_users: number;
  extra_branches: number;
}

export async function getCompanyLimits(companyId: string): Promise<PlanLimits> {
  const { getCompanyPlanLimits } = await import('@/lib/plan-limits');
  const l = await getCompanyPlanLimits(companyId);
  if (l) {
    return {
      planCode: l.planCode,
      max_users: l.max_users,
      max_clients: l.max_clients ?? null,
      max_suppliers: l.max_suppliers ?? null,
      max_employees: l.max_employees ?? null,
      max_projects: l.max_projects ?? null,
      max_invoices_per_month: l.max_invoices_per_month,
      max_quotations_per_month: l.max_quotations_per_month,
      max_storage_mb: l.max_storage_mb,
      features_modules: l.features_modules,
      extra_users: l.extra_users,
      extra_branches: l.extra_branches,
    };
  }
  // Defaults: Start-plan fallback when no subscription exists yet
  return {
    planCode: null,
    max_users: 1,
    max_clients: null,
    max_suppliers: null,
    max_employees: null,
    max_projects: null,
    max_invoices_per_month: 100,
    max_quotations_per_month: 50,
    max_storage_mb: 0,
    features_modules: {
      dashboard: true, accounts: true, journal: true, invoices: true,
      quotations: true, clients: true, contacts: true,
      reports_basic: true, settings: true, subscription: true,
    },
    extra_users: 0,
    extra_branches: 0,
  };
}

export async function checkUsageLimit(
  companyId: string,
  type: 'users' | 'clients' | 'suppliers' | 'employees' | 'projects' | 'invoices' | 'quotations' | 'storage' | 'branches' | 'warehouses',
  currentCount?: number
): Promise<{ allowed: boolean; message?: string; limit: number | null; current: number }> {
  const { checkPlanLimit } = await import('@/lib/plan-limits');
  return checkPlanLimit(companyId, type, currentCount) as any;
}

export async function checkModuleAccess(companyId: string, module: string): Promise<boolean> {
  const { hasModule } = await import('@/lib/plan-limits');
  return hasModule(companyId, module);
}

export class UsageLimitError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'UsageLimitError';
  }
}
