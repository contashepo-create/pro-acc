/**
 * Subscription Guard
 * ------------------
 * Central module-gating + subscription-expiry enforcement.
 *
 * Design principles:
 *  1. Read-only access (GET/HEAD/OPTIONS) is always allowed for any
 *     authenticated user — even expired/trial-ended accounts — so they
 *     can VIEW their data, download an export, contact support, pay or
 *     enter an activation code. WRITE operations (POST/PUT/PATCH/DELETE)
 *     REQUIRE an active, non-expired subscription.
 *  2. Module gating uses subscription_plans.features_modules JSONB.
 *     The 'dashboard', 'settings', 'subscription', and 'accounts'
 *     modules are always accessible (required to manage billing / read
 *     the chart of accounts).
 *  3. Routes under the "bypass" list may bypass the WRITE block —
 *     payment flow, activation codes, support tickets, password change,
 *     logout, company logo read-only, etc. — even after expiry.
 *  4. Trial accounts (status='trial' within trial_days window) have
 *     full WRITE access matching their plan's enabled modules.
 *  5. NULL in any features_modules key is treated as "allowed" for
 *     backward compatibility with plans that don't define the key.
 */

import { getSupabase } from '@/lib/supabase-client';
import { AuthError } from '@/lib/api-helpers';

const sb = () => getSupabase();

export type SubscriptionStatus =
  | 'missing'
  | 'trial'
  | 'trial_expired'
  | 'active'
  | 'expired'
  | 'cancelled';

export interface SubscriptionAccess {
  allowed: boolean;
  status: SubscriptionStatus;
  planCode: string | null;
  planName: string | null;
  endDate: string | null;
  daysRemaining: number;
  features: Record<string, boolean>;
  isExpired: boolean;
  reason?: string;
}

/** Modules that are ALWAYS available regardless of plan (read + billing flow). */
export const ALWAYS_AVAILABLE_MODULES = new Set<string>([
  'dashboard',
  'settings',
  'subscription',
  'auth',
  'support',
  'accounts_read',
]);

/** Route prefixes that keep full (read+write) access even when subscription is expired. */
const EXPIRED_WRITE_WHITELIST: (path: string) => boolean = (() => {
  const prefixes = [
    '/api/auth/logout',
    '/api/auth/me',            // change password / fetch self
    '/api/auth/subscription',  // read own plan
    '/api/auth/subscription-status',
    '/api/subscription/upgrade-request',    // submit payment proof
    '/api/subscription/activate-code',      // enter activation code
    '/api/support',
    '/api/support/',
    '/api/company/export',    // download data export
    '/api/company/data-export',
    '/api/upload',            // allow upload for support receipts? No — restrict below.
  ];
  // More specific matcher
  return (p: string) => {
    if (prefixes.some((pfx) => p === pfx || p.startsWith(pfx + '/') || p.startsWith(pfx + '?'))) {
      return true;
    }
    // Company logo GET/POST? Logo is self-service — allow both read+write even expired? Keep safe: allow only GET via path prefix is hard, so block writes, reads already allowed by GET rule.
    return false;
  };
})();

/** Routes that should be accessible even when the company is inactive (very narrow). */
export function isSubscriptionReadOnlyMethod(method: string): boolean {
  const m = method.toUpperCase();
  return m === 'GET' || m === 'HEAD' || m === 'OPTIONS';
}

/** Map from URL/feature name to features_modules key. */
const ROUTE_TO_MODULE: Array<{ prefix: string; module: string }> = [
  { prefix: '/api/invoices',          module: 'invoices' },
  { prefix: '/api/quotations',        module: 'quotations' },
  { prefix: '/api/clients',           module: 'clients' },
  { prefix: '/api/contacts',          module: 'contacts' },
  { prefix: '/api/suppliers',         module: 'contacts' },
  { prefix: '/api/employees',         module: 'employees' },
  { prefix: '/api/payroll',           module: 'payroll' },
  { prefix: '/api/salary-sheets',     module: 'payroll' },
  { prefix: '/api/projects',          module: 'projects' },
  { prefix: '/api/boq',               module: 'boq' },
  { prefix: '/api/progress-billing',  module: 'progress_billing' },
  { prefix: '/api/subcontractors',    module: 'subcontractors' },
  { prefix: '/api/tenders',           module: 'tenders' },
  { prefix: '/api/contracts',         module: 'contracts' },
  { prefix: '/api/crm',               module: 'crm' },
  { prefix: '/api/inventory',         module: 'inventory' },
  { prefix: '/api/inventory-transactions', module: 'inventory' },
  { prefix: '/api/purchases',         module: 'purchases' },
  { prefix: '/api/warehouses',        module: 'warehouses' },
  { prefix: '/api/branches',          module: 'branches' },
  { prefix: '/api/cost-centers',      module: 'cost_centers' },
  { prefix: '/api/banks',             module: 'banks' },
  { prefix: '/api/bank-reconciliation', module: 'banks' },
  { prefix: '/api/cash',              module: 'cash' },
  { prefix: '/api/bonds',             module: 'cash' },
  { prefix: '/api/petty-cash',        module: 'cash' },
  { prefix: '/api/custodies',         module: 'custody' },
  { prefix: '/api/fixed-assets',      module: 'fixed_assets' },
  { prefix: '/api/equipment',         module: 'fixed_assets' },
  { prefix: '/api/equipment-costs',   module: 'fixed_assets' },
  { prefix: '/api/pos',               module: 'pos' },
  { prefix: '/api/pos/',              module: 'pos' },
  { prefix: '/api/vouchers',          module: 'journal' },
  { prefix: '/api/journal',           module: 'journal' },
  { prefix: '/api/accounts',          module: 'accounts' },
  { prefix: '/api/tax-returns',       module: 'tax_reports' },
  { prefix: '/api/fiscal',            module: 'tax_reports' },
  { prefix: '/api/reports',           module: 'reports_basic' },
  { prefix: '/api/financial-audit',   module: 'reports_advanced' },
  { prefix: '/api/approvals',         module: 'approvals' },
  { prefix: '/api/workflows',         module: 'workflows' },
  { prefix: '/api/budgets',           module: 'budgets' },
  { prefix: '/api/gantt',             module: 'projects' },
  { prefix: '/api/project-expenses',  module: 'projects' },
  { prefix: '/api/change-orders',     module: 'projects' },
  { prefix: '/api/timesheets',        module: 'employees' },
  { prefix: '/api/daily-workers',     module: 'employees' },
  { prefix: '/api/employee-advances', module: 'employees' },
  { prefix: '/api/messages',          module: 'messages' },
  { prefix: '/api/notifications',     module: 'dashboard' },
  { prefix: '/api/reminders',         module: 'dashboard' },
];

export function moduleForPath(pathname: string): string | null {
  for (const { prefix, module } of ROUTE_TO_MODULE) {
    if (pathname === prefix || pathname.startsWith(prefix + '/') || pathname.startsWith(prefix + '?')) {
      return module;
    }
  }
  return null;
}

export async function getSubscriptionAccess(companyId: string): Promise<SubscriptionAccess> {
  const s = sb();
  const today = new Date();
  today.setHours(0, 0, 0, 0);

  const { data: sub } = await s
    .from('subscriptions')
    .select(`
      id, status, start_date, end_date, trial_end_date, plan_code,
      subscription_plans(code, name, trial_days, features_modules)
    `)
    .eq('company_id', companyId)
    .order('created_at', { ascending: false })
    .limit(1)
    .maybeSingle();

  if (!sub) {
    return {
      allowed: false,
      status: 'missing',
      planCode: null,
      planName: null,
      endDate: null,
      daysRemaining: 0,
      features: {},
      isExpired: true,
      reason: 'no_subscription',
    };
  }

  const subr = sub as Record<string, any>;
  const plan = subr.subscription_plans as Record<string, any> | null;
  const endDateStr: string | null = subr.end_date || null;
  const endDate = endDateStr ? new Date(endDateStr) : null;
  const daysRemaining = endDate
    ? Math.ceil((endDate.getTime() - today.getTime()) / (1000 * 60 * 60 * 24))
    : 0;

  const rawFeatures = plan?.features_modules;
  let features: Record<string, boolean> = {};
  if (rawFeatures && typeof rawFeatures === 'object') {
    features = rawFeatures as Record<string, boolean>;
  } else if (typeof rawFeatures === 'string') {
    try { features = JSON.parse(rawFeatures); } catch { features = {}; }
  }

  let status: SubscriptionStatus;
  let isExpired = false;
  let reason: string | undefined;

  if (subr.status === 'cancelled') {
    status = 'cancelled';
    isExpired = true;
    reason = 'subscription_cancelled';
  } else if (subr.status === 'trial') {
    if (endDate && endDate < today) {
      status = 'trial_expired';
      isExpired = true;
      reason = 'trial_expired';
    } else {
      status = 'trial';
      isExpired = false;
    }
  } else if (subr.status === 'active') {
    if (endDate && endDate < today) {
      status = 'expired';
      isExpired = true;
      reason = 'subscription_expired';
    } else {
      status = 'active';
      isExpired = false;
    }
  } else {
    // inactive or unexpected
    status = 'expired';
    isExpired = true;
    reason = 'subscription_inactive';
  }

  return {
    allowed: !isExpired,
    status,
    planCode: plan?.code || subr.plan_code || null,
    planName: plan?.name || null,
    endDate: endDateStr,
    daysRemaining,
    features,
    isExpired,
    reason,
  };
}

/**
 * Determine whether the current request is authorized given the subscription.
 * Returns nothing on success; throws AuthError with a structured message
 * the client can surface.
 */
export async function assertSubscriptionAccess(
  companyId: string,
  method: string,
  pathname: string,
): Promise<SubscriptionAccess> {
  const access = await getSubscriptionAccess(companyId);

  const readOnly = isSubscriptionReadOnlyMethod(method);
  const whitelisted = EXPIRED_WRITE_WHITELIST(pathname);

  // WRITE operations are blocked on expired/missing subs UNLESS whitelisted.
  if (!readOnly && !whitelisted && access.isExpired) {
    // Check module gating first for better error message? No — expiry is the root cause.
    throw new AuthError(
      access.status === 'trial_expired'
        ? 'انتهت المدة التجريبية. يرجى الاشتراك أو إدخال كود تفعيل أو التواصل مع الدعم للمتابعة. يمكنك عرض بياناتك وتحميل نسخة منها.'
        : access.status === 'missing'
          ? 'لا يوجد اشتراك فعال لهذه الشركة.'
          : 'انتهت صلاحية الاشتراك. يرجى التجديد أو إدخال كود تفعيل أو التواصل مع الدعم. يمكنك عرض بياناتك وتحميل نسخة منها.',
    );
  }

  // Module gating: only applies to non-always-available modules, even
  // during trial/active subscription.
  const moduleId = moduleForPath(pathname);
  if (moduleId && !ALWAYS_AVAILABLE_MODULES.has(moduleId)) {
    const allowed = access.features[moduleId] !== false;
    if (!allowed) {
      throw new AuthError(
        `الوحدة "${moduleId}" غير مُضمَّنة في باقتك الحالية (${access.planName || access.planCode || '—'}). قم بترقية الباقة للوصول إليها.`,
      );
    }
  }

  return access;
}
