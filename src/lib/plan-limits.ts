/**
 * Plan-limit enforcement for the new three-tier pricing model:
 *   Start ($15/mo): 100 invoices/mo, 50 quotations/mo, 1 owner, no file storage
 *   Pro   ($35/mo): 500 invoices/mo, 250 quotations/mo, 1 owner, no file storage
 *   Ent.  ($60/mo): unlimited invoices & quotations, 1 owner, no file storage
 *
 * Extra users (+$5/user/mo) and extra branches/warehouses (+$10/branch/mo) are
 * tracked on subscriptions.extra_users / subscriptions.extra_branches.
 *
 * NULL in a max_* column means "unlimited" (matches the Postgres convention
 * throughout the codebase and allows the same plan to be edited in admin).
 */

import { getSupabase } from '@/lib/supabase-client';

import type { Row } from './types';

const sb = () => getSupabase();

export interface PlanLimits {
  planCode: string | null;
  max_users: number;                    // includes extra users from add-ons
  max_projects: number | null;
  max_clients: number | null;          // null = no hard cap in the new model
  max_suppliers: number | null;
  max_employees: number | null;
  max_invoices_per_month: number | null;
  max_quotations_per_month: number | null;
  max_storage_mb: number;              // 0 = no file uploads; add plan base + extra_storage_gb*1024
  max_branches: number;                // base branches (0 unless plan grants) + extra_branches add-on
  max_warehouses: number;              // same pool as branches (1 extra branch = 1 extra warehouse slot)
  features_modules: Record<string, boolean>;
  extra_users: number;
  extra_branches: number;
  extra_storage_gb: number;
}

export async function getCompanyPlanLimits(companyId: string): Promise<PlanLimits | null> {
  const s = sb();
  const { data: sub, error: subscriptionError } = await s
    .from('subscriptions')
    .select(
      'plan_id, plan_code, status, extra_users, extra_branches, extra_storage_gb, addons_json, ' +
      'subscription_plans(code, max_users, max_projects, max_clients, max_suppliers, ' +
      'max_employees, max_invoices_per_month, max_quotations_per_month, max_storage_mb, ' +
      'max_branches, features_modules)'
    )
    .eq('company_id', companyId)
    .order('created_at', { ascending: false })
    .limit(1)
    .maybeSingle();
  if (subscriptionError) throw subscriptionError;
  if (!sub) return null;
  const subr = sub as Row;
  const plan = (subr.subscription_plans ?? null) as Row | null;

  const baseUsers = Number(plan?.max_users ?? 1);
  const extraUsers = Number(subr.extra_users ?? 0);
  const extraBranches = Number(subr.extra_branches ?? 0);
  const extraStorageGb = Number(subr.extra_storage_gb ?? 0);
  // Backward-compat: if the column is missing but addons_json tracks storage purchases,
  // fall back to the addons_json value so old data keeps working until migration 036 runs.
  let effectiveExtraGb = extraStorageGb;
  if (!effectiveExtraGb && subr.addons_json && typeof subr.addons_json === 'object') {
    const legacy = Number((subr.addons_json as Row).extra_storage_gb_paid ?? 0);
    if (legacy > 0) effectiveExtraGb = legacy;
  }
  const baseStorageMb = Number(plan?.max_storage_mb ?? 0);
  const maxStorageMb = baseStorageMb + effectiveExtraGb * 1024;

  // Plans that include branches/warehouses (Pro+ have branches:true) allocate one
  // default branch+warehouse on company creation. Everything beyond that must be
  // paid via the extra_branches add-on.
  const planIncludesBranches = !!(plan?.features_modules && (
    (plan.features_modules as Record<string, unknown>).branches ||
    (plan.features_modules as Record<string, unknown>).warehouses
  ));
  const configuredBranches = plan?.max_branches;
  const baseBranches = configuredBranches == null ? (planIncludesBranches ? 1 : 0) : Number(configuredBranches);
  const maxBranches = baseBranches + extraBranches;

  const features = plan?.features_modules && typeof plan.features_modules === 'object'
    ? (plan.features_modules as Record<string, boolean>)
    : {};

  return {
    planCode: (plan?.code as string | null | undefined) || (subr.plan_code as string | null | undefined) || null,
    max_users: baseUsers + extraUsers,
    max_projects: plan?.max_projects == null ? null : Number(plan.max_projects),
    max_clients: plan?.max_clients == null ? null : Number(plan.max_clients),
    max_suppliers: plan?.max_suppliers == null ? null : Number(plan.max_suppliers),
    max_employees: plan?.max_employees == null ? null : Number(plan.max_employees),
    max_invoices_per_month: plan?.max_invoices_per_month == null ? null : Number(plan.max_invoices_per_month),
    max_quotations_per_month: plan?.max_quotations_per_month == null ? null : Number(plan.max_quotations_per_month),
    max_storage_mb: maxStorageMb,
    max_branches: maxBranches,
    max_warehouses: maxBranches,
    features_modules: features,
    extra_users: extraUsers,
    extra_branches: extraBranches,
    extra_storage_gb: effectiveExtraGb,
  };
}

export type LimitResource =
  | 'projects' | 'clients' | 'suppliers' | 'employees'
  | 'invoices' | 'quotations' | 'users' | 'storage' | 'branches' | 'warehouses';

export async function checkPlanLimit(
  companyId: string,
  resource: LimitResource,
  currentCount?: number
): Promise<{ allowed: boolean; message?: string; limit: number | null; current: number }> {
  const limits = await getCompanyPlanLimits(companyId);
  if (!limits) return { allowed: true, limit: null, current: 0 };

  const labelMap: Record<LimitResource, string> = {
    projects: 'المشاريع',
    clients: 'العملاء',
    suppliers: 'الموردين',
    employees: 'الموظفين',
    invoices: 'الفواتير الشهرية',
    quotations: 'عروض الأسعار الشهرية',
    users: 'المستخدمين',
    storage: 'مساحة التخزين',
    branches: 'الفروع',
    warehouses: 'المستودعات',
  };

  const planLimitMap: Record<LimitResource, number | null> = {
    projects: limits.max_projects,
    clients: limits.max_clients,
    suppliers: limits.max_suppliers,
    employees: limits.max_employees,
    invoices: limits.max_invoices_per_month,
    quotations: limits.max_quotations_per_month,
    users: limits.max_users,
    storage: limits.max_storage_mb,
    branches: limits.max_branches,
    warehouses: limits.max_warehouses,
  };

  const limit = planLimitMap[resource];
  // NULL means unlimited for invoices/quotations/clients/etc.
  if (limit === null || limit === undefined) return { allowed: true, limit: null, current: 0 };

  let count = currentCount;
  if (count === undefined) {
    count = await countResource(resource, companyId);
  }

  if (count >= limit) {
    return {
      allowed: false,
      message: `تم الوصول للحد الأقصى من ${labelMap[resource]} (${limit}) في باقتك الحالية. قم بترقية باقتك أو شراء إضافة.`,
      limit,
      current: count,
    };
  }
  return { allowed: true, limit, current: count };
}

async function countResource(resource: LimitResource, companyId: string): Promise<number> {
  const s = sb();
  const now = new Date();
  const monthStart = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-01`;

  switch (resource) {
    case 'users': {
      const { count, error } = await s.from('users').select('*', { count: 'exact', head: true })
        .eq('company_id', companyId);
      if (error) throw error;
      return count || 0;
    }
    case 'clients': {
      const { count, error } = await s.from('contacts').select('*', { count: 'exact', head: true })
        .eq('company_id', companyId).eq('type', 'client');
      if (error) throw error;
      return count || 0;
    }
    case 'suppliers': {
      const { count, error } = await s.from('contacts').select('*', { count: 'exact', head: true })
        .eq('company_id', companyId).eq('type', 'supplier');
      if (error) throw error;
      return count || 0;
    }
    case 'employees': {
      const { count, error } = await s.from('employees').select('*', { count: 'exact', head: true })
        .eq('company_id', companyId);
      if (error) throw error;
      return count || 0;
    }
    case 'projects': {
      const { count, error } = await s.from('projects').select('*', { count: 'exact', head: true })
        .eq('company_id', companyId);
      if (error) throw error;
      return count || 0;
    }
    case 'invoices': {
      const { count, error } = await s.from('invoices').select('*', { count: 'exact', head: true })
        .eq('company_id', companyId).gte('date', monthStart);
      if (error) throw error;
      return count || 0;
    }
    case 'quotations': {
      // quotations table is 'quotations'; same monthly window.
      const { count, error } = await s.from('quotations').select('*', { count: 'exact', head: true })
        .eq('company_id', companyId).gte('date', monthStart);
      if (error) throw error;
      return count || 0;
    }
    case 'branches': {
      const { count, error } = await s.from('branches').select('*', { count: 'exact', head: true })
        .eq('company_id', companyId);
      if (error) throw error;
      return count || 0;
    }
    case 'warehouses': {
      const { count, error } = await s.from('warehouses').select('*', { count: 'exact', head: true })
        .eq('company_id', companyId);
      if (error) throw error;
      return count || 0;
    }
    case 'storage':
    default:
      return 0;
  }
}

/**
 * Check if a UI/API module is enabled for the company's plan.
 * Features are taken from subscription_plans.features_modules JSONB.
 * Unknown modules default to true for backward compatibility.
 */
export async function hasModule(companyId: string, moduleId: string): Promise<boolean> {
  const limits = await getCompanyPlanLimits(companyId);
  if (!limits) return true;
  const fm = limits.features_modules;
  if (Object.keys(fm).length === 0) return true;
  return fm[moduleId] !== false;
}
