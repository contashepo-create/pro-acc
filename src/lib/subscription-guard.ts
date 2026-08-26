/**
 * Subscription Guard
 * ------------------
 * Central module-gating + subscription-expiry enforcement.
 *
 * Design principles:
 *  1. When the subscription is EXPIRED (or trial ended / cancelled /
 *     pending / missing) the account loses access to every module — READS
 *     INCLUDED. The only reachable surface is the renewal flow (payment,
 *     activation code, add-ons, support) plus the self-service TABLE
 *     download of the company's own data (Excel/CSV). This mirrors how
 *     mainstream accounting SaaS handles lapsed subscriptions: you get a
 *     billing screen and your data, nothing else.
 *  2. Module gating uses subscription_plans.features_modules JSONB.
 *     The 'dashboard', 'settings', 'subscription', and 'accounts'
 *     modules are always accessible for LIVE subscriptions (required to
 *     manage billing / read the chart of accounts).
 *  3. The EXPIRED_ACCESS_WHITELIST below is the complete list of routes
 *     that keep working after expiry — renewal, support and the table
 *     export.
 *  4. Trial accounts (status='trial' within trial_days window) have
 *     full WRITE access matching their plan's enabled modules.
 *  5. NULL in any features_modules key is treated as "allowed" for
 *     backward compatibility with plans that don't define the key.
 */

import { getSupabase } from '@/lib/supabase-client';
import { AuthError } from '@/lib/api-helpers';

import type { Row } from './types';

const sb = () => getSupabase();

export type SubscriptionStatus =
  | 'missing'
  | 'trial'
  | 'pending'
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
const EXPIRED_ACCESS_WHITELIST: (path: string) => boolean = (() => {
  const prefixes = [
    '/api/auth/logout',
    '/api/auth/me',            // change password / fetch self
    '/api/auth/subscription',  // read own plan
    '/api/auth/subscription-status',
    '/api/auth/subscribe',              // initiate a payment; never activates a paid plan
    '/api/subscription/upgrade-request',    // submit payment proof
    '/api/subscription/activate-code',      // enter activation code
    '/api/subscription/addon-request',      // buy add-ons while renewing
    '/api/support',
    '/api/support/',
    '/api/company/export-download',  // TABLE export (Excel/CSV) of the company's own data
    '/api/upload/receipt',           // attach a payment receipt while renewing
    '/api/payment-methods',          // list active payment methods on the renewal page
  ];
  // More specific matcher
  return (p: string) => {
    if (prefixes.some((pfx) => p === pfx || p.startsWith(pfx + '/') || p.startsWith(pfx + '?'))) {
      return true;
    }
    return false;
  };
})();

/**
 * Legacy helper kept for rate-limit budgets and tests: identifies read-only
 * HTTP methods. NOTE: since expiry now blocks reads too, this NO LONGER
 * grants any access on its own — see assertSubscriptionAccess.
 */
export function isSubscriptionReadOnlyMethod(method: string | undefined): boolean {
  const m = (method || 'GET').toUpperCase();
  return m === 'GET' || m === 'HEAD' || m === 'OPTIONS';
}

/** Map from URL/feature name to features_modules key. */
const ROUTE_TO_MODULE: Array<{ prefix: string; module: string }> = [
  { prefix: '/api/invoices',          module: 'invoices' },
  { prefix: '/api/credit-notes',      module: 'invoices' },
  { prefix: '/api/quotations',        module: 'quotations' },
  { prefix: '/api/clients',           module: 'clients' },
  { prefix: '/api/contacts',          module: 'contacts' },
  { prefix: '/api/suppliers',         module: 'contacts' },
  { prefix: '/api/employees',         module: 'employees' },
  { prefix: '/api/payroll',           module: 'payroll' },
  { prefix: '/api/salary-sheets',     module: 'payroll' },
  { prefix: '/api/timesheets',        module: 'employees' },
  { prefix: '/api/daily-workers',     module: 'employees' },
  { prefix: '/api/employee-advances', module: 'employees' },
  { prefix: '/api/projects',          module: 'projects' },
  { prefix: '/api/gantt',             module: 'projects' },
  { prefix: '/api/project-expenses',  module: 'projects' },
  { prefix: '/api/change-orders',     module: 'projects' },
  { prefix: '/api/boq',               module: 'boq' },
  { prefix: '/api/progress-billing',  module: 'progress_billing' },
  { prefix: '/api/subcontractors',    module: 'subcontractors' },
  { prefix: '/api/tenders',           module: 'tenders' },
  { prefix: '/api/contracts',         module: 'contracts' },
  { prefix: '/api/crm',               module: 'crm' },
  { prefix: '/api/inventory',         module: 'inventory' },
  { prefix: '/api/inventory-transactions', module: 'inventory' },
  { prefix: '/api/purchases',         module: 'purchases' },
  { prefix: '/api/bank-reconciliation', module: 'banks' },
  { prefix: '/api/warehouses',        module: 'warehouses' },
  { prefix: '/api/branches',          module: 'branches' },
  { prefix: '/api/cost-centers',      module: 'cost_centers' },
  { prefix: '/api/banks',             module: 'banks' },
  { prefix: '/api/bank-reconciliation', module: 'banks' },
  { prefix: '/api/cash',              module: 'cash' },
  { prefix: '/api/bonds',             module: 'cash' },
  { prefix: '/api/petty-cash',        module: 'cash' },
  { prefix: '/api/payments',          module: 'cash' },
  { prefix: '/api/custodies',         module: 'custody' },
  { prefix: '/api/fixed-assets',      module: 'fixed_assets' },
  { prefix: '/api/equipment',         module: 'fixed_assets' },
  { prefix: '/api/equipment-costs',   module: 'fixed_assets' },
  { prefix: '/api/pos',               module: 'pos' },
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
  { prefix: '/api/messages',          module: 'messages' },
  { prefix: '/api/notifications',     module: 'dashboard' },
  { prefix: '/api/reminders',         module: 'dashboard' },
  { prefix: '/api/categories',        module: 'settings' },     // global taxonomy, always available
  { prefix: '/api/currencies',        module: 'settings' },
  { prefix: '/api/dashboard',         module: 'dashboard' },
  { prefix: '/api/permissions',       module: 'settings' },
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

  const subr = sub as Row;
  const plan = subr.subscription_plans as Row | null;
  const endDateStr: string | null = subr.end_date == null ? null : String(subr.end_date);
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
  } else if (subr.status === 'pending') {
    // A paid checkout exists but the payment provider has not confirmed it.
    // It must never grant write access before an authenticated webhook does.
    status = 'pending';
    isExpired = true;
    reason = 'payment_pending';
  } else {
    // inactive or unexpected
    status = 'expired';
    isExpired = true;
    reason = 'subscription_inactive';
  }

  return {
    allowed: !isExpired,
    status,
    planCode: plan?.code != null ? String(plan.code) : subr.plan_code != null ? String(subr.plan_code) : null,
    planName: plan?.name != null ? String(plan.name) : null,
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

  const whitelisted = EXPIRED_ACCESS_WHITELIST(pathname);

  // An expired/missing/cancelled/pending subscription locks EVERY module —
  // reads included — except the renewal flow and the table data download.
  // This is the enforcement point behind "لا يتصفح العميل أي قسم بعد انتهاء
  // اشتراكه؛ يوجَّه لتجديد الاشتراك أو تحميل جداول بياناته فقط".
  if (access.isExpired && !whitelisted) {
    throw new AuthError(
      access.status === 'trial_expired'
        ? 'انتهت المدة التجريبية. يرجى الاشتراك أو إدخال كود تفعيل أو التواصل مع الدعم للمتابعة. يمكنك تحميل جداول بياناتك (Excel/CSV) من صفحة الباقات والاشتراك.'
        : access.status === 'missing'
          ? 'لا يوجد اشتراك فعال لهذه الشركة. يمكنك تفعيل اشتراك أو تحميل جداول بياناتك (Excel/CSV) من صفحة الباقات والاشتراك.'
          : 'انتهت صلاحية الاشتراك. يرجى التجديد أو إدخال كود تفعيل أو التواصل مع الدعم. يمكنك تحميل جداول بياناتك (Excel/CSV) من صفحة الباقات والاشتراك.',
      403,
    );
  }

  // Module gating: only applies to non-always-available modules, even
  // during trial/active subscription. Unknown modules default to allowed
  // for backward compatibility (undefined !== false). Sub-modules like
  // purchase_invoices/purchase_orders resolve to the umbrella 'purchases'
  // flag so fine-grained permissions don't accidentally lock out a plan
  // that has purchases enabled.
  const moduleId = moduleForPath(pathname);
  if (moduleId && !ALWAYS_AVAILABLE_MODULES.has(moduleId)) {
    // Sub-modules like nested /purchases/invoices are covered by the
    // umbrella '/api/purchases' prefix; no alias map needed because our
    // prefix matching always resolves to the parent key.
    const flag = access.features[moduleId];
    const allowed = flag !== false;
    if (!allowed) {
      throw new AuthError(
        `الوحدة "${moduleId}" غير مُضمَّنة في باقتك الحالية (${access.planName || access.planCode || '—'}). قم بترقية الباقة للوصول إليها.`,
        403,
      );
    }
  }

  return access;
}
