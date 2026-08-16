const PLAN_CODE = /^[a-z0-9][a-z0-9_-]{1,31}$/;
const CURRENCY = /^[A-Z]{3}$/;

export const PLAN_MODULES = new Set([
  'dashboard','accounts','journal','invoices','quotations','clients','contacts',
  'reports_basic','reports_advanced','reports_consolidated','settings','subscription',
  'messages','inventory','purchases','purchase_invoices','purchase_orders','cost_centers',
  'banks','cash','custody','warehouses','branches','employees','payroll','projects',
  'budgets','tax_reports','fixed_assets','pos','workflows','approvals','crm','contracts',
  'tenders','boq','progress_billing','subcontractors','backup','telegram_integration',
]);

const INT_FIELDS = [
  'yearly_discount_percent','trial_days','max_users','max_clients','max_suppliers',
  'max_employees','max_projects','max_invoices_per_month','max_quotations_per_month',
  'max_storage_mb','sort_order',
] as const;

const ALIASES: Record<string, string[]> = {
  price_monthly: ['price_monthly', 'priceMonthly'],
  price_yearly: ['price_yearly', 'priceYearly'],
  max_users: ['max_users', 'maxUsers'],
  max_projects: ['max_projects', 'maxProjects'],
};

function first(input: Record<string, unknown>, fields: string[]): { present: boolean; value: unknown } {
  for (const field of fields) if (Object.prototype.hasOwnProperty.call(input, field)) return { present: true, value: input[field] };
  return { present: false, value: undefined };
}

function parseMoney(value: unknown): number | null | undefined {
  if (value === null || value === '') return null;
  if (typeof value !== 'number' && typeof value !== 'string') return undefined;
  if (typeof value === 'string' && !/^\d+(?:\.\d{1,2})?$/.test(value.trim())) return undefined;
  const number = Number(value);
  if (!Number.isFinite(number) || number < 0 || number > 1_000_000_000 || Math.abs(number * 100 - Math.round(number * 100)) > 1e-8) return undefined;
  return number;
}

function parseInteger(value: unknown, nullable = true): number | null | undefined {
  if (value === null || value === '') return nullable ? null : undefined;
  if (typeof value !== 'number' && typeof value !== 'string') return undefined;
  if (typeof value === 'string' && !/^\d+$/.test(value.trim())) return undefined;
  const number = Number(value);
  if (!Number.isSafeInteger(number) || number < 0 || number > 1_000_000_000) return undefined;
  return number;
}

export type PlanInputResult =
  | { ok: true; payload: Record<string, unknown> }
  | { ok: false; message: string };

/** Normalize and strictly validate the administration plan editor payload. */
export function normalizeAdminPlanInput(input: unknown, partial = false): PlanInputResult {
  if (!input || typeof input !== 'object' || Array.isArray(input)) return { ok: false, message: 'بيانات الباقة غير صالحة' };
  const body = input as Record<string, unknown>;
  const payload: Record<string, unknown> = {};

  if (!partial || body.code !== undefined) {
    if (typeof body.code !== 'string' || !PLAN_CODE.test(body.code.trim().toLowerCase())) return { ok: false, message: 'كود الباقة غير صالح' };
    payload.code = body.code.trim().toLowerCase();
  }
  if (!partial || body.name !== undefined) {
    if (typeof body.name !== 'string' || !body.name.trim() || body.name.trim().length > 120) return { ok: false, message: 'اسم الباقة مطلوب ضمن 120 حرفاً' };
    payload.name = body.name.trim();
  }
  for (const field of ['description', 'description_ar'] as const) {
    if (body[field] === undefined) continue;
    if (typeof body[field] !== 'string' || body[field].length > 500) return { ok: false, message: 'وصف الباقة طويل جداً' };
    payload[field] = body[field].trim();
  }
  if (!partial || body.currency !== undefined) {
    const value = body.currency === undefined ? 'USD' : body.currency;
    if (typeof value !== 'string' || !CURRENCY.test(value)) return { ok: false, message: 'عملة الباقة غير صالحة' };
    payload.currency = value;
  }

  for (const field of ['price_monthly', 'price_yearly'] as const) {
    const candidate = first(body, ALIASES[field]);
    if (!candidate.present && partial) continue;
    const value = candidate.present ? candidate.value : (field === 'price_monthly' ? 0 : null);
    const parsed = parseMoney(value);
    if (parsed === undefined || (field === 'price_monthly' && parsed === null)) return { ok: false, message: 'سعر الباقة غير صالح' };
    payload[field] = parsed;
  }

  for (const field of INT_FIELDS) {
    const candidate = first(body, ALIASES[field] || [field]);
    if (!candidate.present && partial) continue;
    let fallback: number | null = null;
    if (!partial) {
      if (field === 'yearly_discount_percent') fallback = 20;
      else if (field === 'trial_days') fallback = 7;
      else if (field === 'max_users') fallback = 1;
      else if (field === 'max_invoices_per_month') fallback = 100;
      else if (field === 'max_quotations_per_month') fallback = 50;
      else if (field === 'max_storage_mb' || field === 'sort_order') fallback = 0;
    }
    const parsed = parseInteger(candidate.present ? candidate.value : fallback, !['yearly_discount_percent','trial_days','max_users','max_storage_mb','sort_order'].includes(field));
    if (parsed === undefined) return { ok: false, message: `قيمة ${field} غير صالحة` };
    if (field === 'yearly_discount_percent' && parsed !== null && parsed > 100) return { ok: false, message: 'نسبة الخصم غير صالحة' };
    if (field === 'trial_days' && parsed !== null && parsed > 3650) return { ok: false, message: 'مدة التجربة غير صالحة' };
    if (field === 'max_users' && (parsed === null || parsed < 1)) return { ok: false, message: 'حد المستخدمين غير صالح' };
    if (field === 'sort_order' && parsed !== null && parsed > 10000) return { ok: false, message: 'ترتيب الباقة غير صالح' };
    payload[field] = parsed;
  }

  if (body.features_modules !== undefined || !partial) {
    const modules = body.features_modules ?? {};
    if (!modules || typeof modules !== 'object' || Array.isArray(modules) || Object.keys(modules).length > PLAN_MODULES.size) return { ok: false, message: 'وحدات الباقة غير صالحة' };
    const normalized: Record<string, boolean> = {};
    for (const [key, value] of Object.entries(modules as Record<string, unknown>)) {
      if (!PLAN_MODULES.has(key) || typeof value !== 'boolean') return { ok: false, message: `وحدة باقة غير صالحة: ${key}` };
      normalized[key] = value;
    }
    payload.features_modules = normalized;
  }
  if (body.features !== undefined) {
    if (!Array.isArray(body.features) || body.features.length > PLAN_MODULES.size || body.features.some((item) => typeof item !== 'string' || !PLAN_MODULES.has(item))) {
      return { ok: false, message: 'قائمة ميزات الباقة غير صالحة' };
    }
    payload.features = [...new Set(body.features)];
  }
  if (body.is_active !== undefined || body.isActive !== undefined || !partial) {
    const value = body.is_active ?? body.isActive ?? true;
    if (typeof value !== 'boolean') return { ok: false, message: 'حالة الباقة غير صالحة' };
    payload.is_active = value;
  }

  if (partial && Object.keys(payload).length === 0) return { ok: false, message: 'لا توجد حقول قابلة للتحديث' };
  return { ok: true, payload };
}
