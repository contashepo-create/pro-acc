import { getSupabase } from '@/lib/supabase-client';

const sb = () => getSupabase();

export interface PlanLimits {
  max_users: number;
  max_clients: number;
  max_suppliers: number;
  max_employees: number;
  max_projects: number;
  max_invoices_per_month: number;
  max_storage_mb: number;
  features_modules: Record<string, boolean>;
}

export async function getCompanyLimits(companyId: string): Promise<PlanLimits> {
  const s = sb();
  
  // Get company's current plan
  const { data: sub } = await s.from('subscriptions')
    .select('plan_id')
    .eq('company_id', companyId)
    .order('created_at', { ascending: false })
    .limit(1)
    .single();

  let planId = null;
  if (sub) planId = (sub as any).plan_id;

  // Get plan details
  let limits: PlanLimits = {
    max_users: 1,
    max_clients: 10,
    max_suppliers: 10,
    max_employees: 5,
    max_projects: 2,
    max_invoices_per_month: 20,
    max_storage_mb: 100,
    features_modules: { dashboard: true, accounts: true, journal: true, invoices: true, clients: true, reports: true, settings: true },
  };

  if (planId) {
    const { data: plan } = await s.from('subscription_plans')
      .select('max_users, max_clients, max_suppliers, max_employees, max_projects, max_invoices_per_month, max_storage_mb, features_modules')
      .eq('id', planId)
      .single();
    
    if (plan) {
      const p: any = plan;
      limits = {
        max_users: p.max_users || limits.max_users,
        max_clients: p.max_clients || limits.max_clients,
        max_suppliers: p.max_suppliers || limits.max_suppliers,
        max_employees: p.max_employees || limits.max_employees,
        max_projects: p.max_projects || limits.max_projects,
        max_invoices_per_month: p.max_invoices_per_month || limits.max_invoices_per_month,
        max_storage_mb: p.max_storage_mb || limits.max_storage_mb,
        features_modules: p.features_modules || limits.features_modules,
      };
    }
  }

  return limits;
}

export async function checkUsageLimit(
  companyId: string,
  type: 'users' | 'clients' | 'suppliers' | 'employees' | 'projects' | 'invoices' | 'storage',
  currentCount?: number
): Promise<{ allowed: boolean; message?: string; limit: number; current: number }> {
  const limits = await getCompanyLimits(companyId);
  const s = sb();

  let limit = 0;
  let current = currentCount || 0;

  switch (type) {
    case 'users':
      limit = limits.max_users;
      if (currentCount === undefined) {
        const { count } = await s.from('users').select('id', { count: 'exact', head: true }).eq('company_id', companyId);
        current = count || 0;
      }
      break;
    case 'clients':
      limit = limits.max_clients;
      if (currentCount === undefined) {
        const { count } = await s.from('contacts').select('id', { count: 'exact', head: true }).eq('company_id', companyId).eq('type', 'client');
        current = count || 0;
      }
      break;
    case 'suppliers':
      limit = limits.max_suppliers;
      if (currentCount === undefined) {
        const { count } = await s.from('contacts').select('id', { count: 'exact', head: true }).eq('company_id', companyId).eq('type', 'supplier');
        current = count || 0;
      }
      break;
    case 'employees':
      limit = limits.max_employees;
      if (currentCount === undefined) {
        const { count } = await s.from('employees').select('id', { count: 'exact', head: true }).eq('company_id', companyId);
        current = count || 0;
      }
      break;
    case 'projects':
      limit = limits.max_projects;
      if (currentCount === undefined) {
        const { count } = await s.from('projects').select('id', { count: 'exact', head: true }).eq('company_id', companyId);
        current = count || 0;
      }
      break;
    case 'invoices':
      limit = limits.max_invoices_per_month;
      if (currentCount === undefined) {
        const firstDay = new Date(new Date().getFullYear(), new Date().getMonth(), 1).toISOString().split('T')[0];
        const { count } = await s.from('invoices').select('id', { count: 'exact', head: true }).eq('company_id', companyId).gte('date', firstDay);
        current = count || 0;
      }
      break;
    case 'storage':
      limit = limits.max_storage_mb;
      // For storage, current is in MB, would need to calculate from file sizes
      current = 0;
      break;
  }

  // 9999 means unlimited
  if (limit >= 9999) {
    return { allowed: true, limit, current };
  }

  if (current >= limit) {
    return {
      allowed: false,
      limit,
      current,
      message: `تم الوصول للحد الأقصى المسموح به في باقتك الحالية (${limit}). يرجى الترقية إلى باقة أعلى.`,
    };
  }

  return { allowed: true, limit, current };
}

export async function checkModuleAccess(companyId: string, module: string): Promise<boolean> {
  const limits = await getCompanyLimits(companyId);
  // If module not in features, allow by default for backward compatibility
  if (!limits.features_modules || Object.keys(limits.features_modules).length === 0) {
    return true;
  }
  return limits.features_modules[module] !== false;
}

export class UsageLimitError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'UsageLimitError';
  }
}
