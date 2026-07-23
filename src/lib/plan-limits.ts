/**
 * تطبيق حدود الباقات على العمليات
 * يتحقق من max_users, max_projects, max_clients, max_suppliers, max_employees, max_invoices_per_month
 */

import { getSupabase } from '@/lib/supabase-client';

const sb = () => getSupabase();

export interface PlanLimits {
  max_users: number | null;
  max_projects: number | null;
  max_clients: number | null;
  max_suppliers: number | null;
  max_employees: number | null;
  max_invoices_per_month: number | null;
  max_storage_mb: number | null;
}

export async function getCompanyPlanLimits(companyId: string): Promise<PlanLimits | null> {
  const s = sb();
  const { data: sub } = await s.from('subscriptions')
    .select('plan_id, status, subscription_plans(max_users, max_projects, max_clients, max_suppliers, max_employees, max_invoices_per_month, max_storage_mb)')
    .eq('company_id', companyId)
    .order('created_at', { ascending: false })
    .limit(1)
    .maybeSingle();

  if (!sub || !(sub as any).subscription_plans) return null;

  const plan = (sub as any).subscription_plans;
  return {
    max_users: plan.max_users,
    max_projects: plan.max_projects,
    max_clients: plan.max_clients,
    max_suppliers: plan.max_suppliers,
    max_employees: plan.max_employees,
    max_invoices_per_month: plan.max_invoices_per_month,
    max_storage_mb: plan.max_storage_mb,
  };
}

export async function checkPlanLimit(
  companyId: string,
  resource: 'projects' | 'clients' | 'suppliers' | 'employees' | 'invoices',
  currentCount?: number
): Promise<{ allowed: boolean; message?: string; limit: number | null; current: number }> {
  const limits = await getCompanyPlanLimits(companyId);
  if (!limits) return { allowed: true, limit: null, current: 0 };

  const limitMap: Record<string, number | null> = {
    projects: limits.max_projects,
    clients: limits.max_clients,
    suppliers: limits.max_suppliers,
    employees: limits.max_employees,
    invoices: limits.max_invoices_per_month,
  };

  const limit = limitMap[resource];
  if (limit === null || limit === undefined) return { allowed: true, limit: null, current: 0 };

  let count = currentCount;
  if (count === undefined) {
    const s = sb();
    const tableMap: Record<string, string> = {
      projects: 'projects',
      clients: 'contacts',
      suppliers: 'contacts',
      employees: 'employees',
      invoices: 'invoices',
    };

    let query = s.from(tableMap[resource]).select('*', { count: 'exact', head: true }).eq('company_id', companyId);

    if (resource === 'clients') query = (query as any).eq('type', 'client');
    if (resource === 'suppliers') query = (query as any).eq('type', 'supplier');
    if (resource === 'invoices') {
      const now = new Date();
      const monthStart = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-01`;
      query = (query as any).gte('date', monthStart);
    }

    const { count: dbCount } = await query;
    count = dbCount || 0;
  }

  if (count >= limit) {
    const labels: Record<string, string> = {
      projects: 'المشاريع',
      clients: 'العملاء',
      suppliers: 'الموردين',
      employees: 'الموظفين',
      invoices: 'الفواتير الشهرية',
    };
    return { allowed: false, message: `تم الوصول للحد الأقصى من ${labels[resource]} (${limit}). قم بترقية باقتك.`, limit, current: count };
  }

  return { allowed: true, limit, current: count };
}
