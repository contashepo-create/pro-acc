/**
 * نظام الصلاحيات المتقدم
 * يدعم:
 * 1. صلاحيات على مستوى الأدوار (admin, manager, accountant, supervisor)
 * 2. صلاحيات مخصصة لكل مستخدم (تخطي أو تقييد)
 * 3. صلاحيات على مستوى الوحدات (modules)
 * 4. صلاحيات على مستوى العمليات (actions: create, read, update, delete, approve)
 */

import { getSupabase } from '@/lib/supabase-client';

const sb = () => getSupabase();

// تعريف الوحدات المتاحة في النظام
export const MODULES = {
  // الوحدات المالية
  INVOICES: 'invoices',
  VOUCHERS: 'vouchers',
  RECEIPTS: 'receipts',
  DISBURSEMENTS: 'disbursements',
  JOURNAL: 'journal',
  CASH: 'cash',
  BANKS: 'banks',
  
  // الحسابات
  ACCOUNTS: 'accounts',
  ACCOUNTS_TREE: 'accounts_tree',
  
  // الأطراف
  CLIENTS: 'clients',
  SUPPLIERS: 'suppliers',
  CONTACTS: 'contacts',
  EMPLOYEES: 'employees',
  SUBCONTRACTORS: 'subcontractors',
  
  // المشاريع
  PROJECTS: 'projects',
  BOQ: 'boq',
  PROGRESS_BILLING: 'progress_billing',
  
  // المشتريات
  PURCHASE_ORDERS: 'purchase_orders',
  PURCHASE_INVOICES: 'purchase_invoices',
  
  // المخزون
  INVENTORY: 'inventory',
  WAREHOUSES: 'warehouses',
  INVENTORY_TRANSACTIONS: 'inventory_transactions',
  
  // الأصول
  FIXED_ASSETS: 'fixed_assets',
  CUSTODIES: 'custodies',
  
  // الرواتب
  PAYROLL: 'payroll',
  SALARY_SHEETS: 'salary_sheets',
  EMPLOYEE_ADVANCES: 'employee_advances',
  
  // التقارير
  REPORTS: 'reports',
  FINANCIAL_REPORTS: 'financial_reports',
  
  // الإدارة
  USERS: 'users',
  SETTINGS: 'settings',
  SUBSCRIPTION: 'subscription',
  TELEGRAM: 'telegram',
  
  // أخرى
  CATEGORIES: 'categories',
  CURRENCIES: 'currencies',
  DAILY_WORKERS: 'daily_workers',
  FISCAL: 'fiscal',
  QUOTATIONS: 'quotations',
} as const;

export type Module = typeof MODULES[keyof typeof MODULES];

// العمليات المتاحة
export const ACTIONS = {
  CREATE: 'create',
  READ: 'read',
  UPDATE: 'update',
  DELETE: 'delete',
  APPROVE: 'approve',
  EXPORT: 'export',
  PRINT: 'print',
} as const;

export type Action = typeof ACTIONS[keyof typeof ACTIONS];

// الصلاحيات الافتراضية لكل دور
const DEFAULT_ROLE_PERMISSIONS: Record<string, Record<string, string[]>> = {
  admin: {
    // المدير لديه صلاحية كاملة على كل شيء
    '*': ['create', 'read', 'update', 'delete', 'approve', 'export', 'print'],
  },
  manager: {
    // المدير يستطيع كل شيء ماعدا إدارة المستخدمين والإعدادات الحساسة
    '*': ['create', 'read', 'update', 'delete', 'approve', 'export', 'print'],
    [MODULES.USERS]: ['read'], // فقط قراءة المستخدمين
    [MODULES.SETTINGS]: ['read'], // فقط قراءة الإعدادات
    [MODULES.SUBSCRIPTION]: ['read'], // فقط قراءة الاشتراك
  },
  accountant: {
    // المحاسب يستطيع إنشاء وتعديل ولكن ليس الحذف أو الموافقة
    '*': ['create', 'read', 'update', 'export', 'print'],
    [MODULES.USERS]: [], // لا وصول
    [MODULES.SETTINGS]: ['read'], // فقط قراءة
    [MODULES.REPORTS]: ['read', 'export', 'print'],
    [MODULES.FINANCIAL_REPORTS]: ['read', 'export', 'print'],
  },
  supervisor: {
    // المشرف يقرأ فقط مع إمكانية التصدير
    '*': ['read', 'export', 'print'],
    [MODULES.USERS]: [],
    [MODULES.SETTINGS]: [],
  },
};

/**
 * الصلاحيات الخاصة بتخطي تأكيد التيليجرام
 * يمكن تعيينها لكل مستخدم بشكل فردي
 */
export async function canBypassTelegramConfirmation(
  userId: string,
  companyId: string
): Promise<boolean> {
  const s = sb();

  // التحقق من إعدادات المستخدم
  const { data: userPerm } = await s.from('user_permissions')
    .select('bypass_telegram_confirmation')
    .eq('user_id', userId)
    .eq('company_id', companyId)
    .maybeSingle();

  if (userPerm && (userPerm as any).bypass_telegram_confirmation === true) {
    return true;
  }

  // التحقق من دور المستخدم - المدير والمدير التنفيذي يمكنهم التخطي
  const { data: user } = await s.from('users')
    .select('role')
    .eq('id', userId)
    .maybeSingle();

  if (user && (user as any).role === 'admin') {
    return true;
  }

  return false;
}

/**
 * التحقق من صلاحية مستخدم لوحدة معينة
 */
export async function hasModulePermission(
  userId: string,
  companyId: string,
  module: string,
  action: string
): Promise<boolean> {
  const s = sb();

  // أولاً: جلب دور المستخدم
  const { data: user } = await s.from('users')
    .select('role')
    .eq('id', userId)
    .eq('company_id', companyId)
    .maybeSingle();

  if (!user) return false;

  const role = (user as any).role;

  // ثانياً: التحقق من الصلاحيات المخصصة للمستخدم
  const { data: customPerm } = await s.from('user_permissions')
    .select('permissions')
    .eq('user_id', userId)
    .eq('company_id', companyId)
    .eq('module', module)
    .maybeSingle();

  // إذا كانت هناك صلاحيات مخصصة، استخدمها
  if (customPerm) {
    const perms = (customPerm as any).permissions as string[];
    return perms.includes(action) || perms.includes('*');
  }

  // ثالثاً: استخدام الصلاحيات الافتراضية للدور
  const rolePerms = DEFAULT_ROLE_PERMISSIONS[role] || DEFAULT_ROLE_PERMISSIONS.supervisor;
  
  // التحقق من صلاحيات خاصة بالوحدة
  if (rolePerms[module]) {
    return rolePerms[module].includes(action) || rolePerms[module].includes('*');
  }

  // التحقق من الصلاحيات العامة (wildcard)
  if (rolePerms['*']) {
    return rolePerms['*'].includes(action) || rolePerms['*'].includes('*');
  }

  return false;
}

/**
 * جلب جميع صلاحيات مستخدم (للعرض في الواجهة)
 */
export async function getUserPermissions(userId: string, companyId: string) {
  const s = sb();

  // جلب الصلاحيات المخصصة
  const { data: customPerms } = await s.from('user_permissions')
    .select('module, permissions, bypass_telegram_confirmation')
    .eq('user_id', userId)
    .eq('company_id', companyId);

  // جلب دور المستخدم
  const { data: user } = await s.from('users')
    .select('role')
    .eq('id', userId)
    .maybeSingle();

  const role = (user as any)?.role || 'supervisor';
  const defaultPerms = DEFAULT_ROLE_PERMISSIONS[role] || {};

  return {
    role,
    defaultPermissions: defaultPerms,
    customPermissions: customPerms || [],
  };
}

/**
 * حفظ صلاحيات مخصصة لمستخدم
 */
export async function setUserPermission(
  userId: string,
  companyId: string,
  module: string,
  actions: string[],
  bypassTelegram: boolean = false
) {
  const s = sb();

  // حذف الصلاحيات القديمة لنفس الوحدة
  await s.from('user_permissions')
    .delete()
    .eq('user_id', userId)
    .eq('company_id', companyId)
    .eq('module', module);

  // إدراج الصلاحيات الجديدة
  if (actions.length > 0) {
    await s.from('user_permissions')
      .insert({
        user_id: userId,
        company_id: companyId,
        module,
        permissions: actions,
        bypass_telegram_confirmation: bypassTelegram,
      });
  } else if (bypassTelegram) {
    // حفظ إعداد تخطي التأكيد حتى بدون صلاحيات وحدة
    await s.from('user_permissions')
      .insert({
        user_id: userId,
        company_id: companyId,
        module: module || 'general',
        permissions: [],
        bypass_telegram_confirmation: bypassTelegram,
      });
  }
}

/**
 * جلب قائمة المستخدمين الفرعيين للشركة مع صلاحياتهم
 */
export async function getCompanyUsersWithPermissions(companyId: string) {
  const s = sb();

  const { data: users } = await s.from('users')
    .select('id, name, email, role, is_active, last_login')
    .eq('company_id', companyId)
    .order('name');

  if (!users) return [];

  const { data: perms } = await s.from('user_permissions')
    .select('user_id, module, permissions, bypass_telegram_confirmation')
    .eq('company_id', companyId);

  const permsMap = new Map<string, any[]>();
  for (const p of perms || []) {
    const uid = (p as any).user_id;
    if (!permsMap.has(uid)) permsMap.set(uid, []);
    permsMap.get(uid)!.push(p);
  }

  return (users as any[]).map(u => ({
    ...u,
    permissions: permsMap.get(u.id) || [],
  }));
}

export { DEFAULT_ROLE_PERMISSIONS };
