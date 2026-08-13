import { requireAdmin, adminJsonError } from '@/lib/admin-guard';
import { NextRequest } from 'next/server';
import { getSupabase } from '@/lib/supabase-client';
import { success, error, parseBody } from '@/lib/api-helpers';

const sb = () => getSupabase();

const SAFE_CODE = /^[a-z0-9_-]{2,32}$/i;

export async function GET(req: NextRequest) {
  try {
    await requireAdmin(req);
    const s = sb();
    const { data, error: err } = await s.from('subscription_plans')
      .select('id, code, name, description, description_ar, currency, price_monthly, price_yearly, yearly_discount_percent, trial_days, max_users, max_clients, max_suppliers, max_employees, max_projects, max_invoices_per_month, max_quotations_per_month, max_storage_mb, features, features_modules, is_active, sort_order, created_at, updated_at')
      .order('sort_order')
      .order('price_monthly', { ascending: true });
    if (err) {
      console.error('Error fetching plans:', err);
      return success({ plans: [] });
    }
    return success({ plans: data || [] });
  } catch (e: any) {
    return adminJsonError(e);
  }
}

function normInt(v: unknown, def: number | null = null): number | null {
  if (v === null || v === undefined || v === '') return def;
  const n = Number(v);
  if (!Number.isFinite(n)) return def;
  return Math.max(0, Math.floor(n));
}

export async function POST(req: NextRequest) {
  try {
    await requireAdmin(req);
    const body = await parseBody(req);
    const {
      code, name, description, description_ar,
      priceMonthly, price_monthly, priceYearly, price_yearly,
      yearly_discount_percent, trial_days,
      maxUsers, max_users, max_clients, max_suppliers, max_employees,
      maxProjects, max_projects, max_invoices_per_month, max_quotations_per_month, max_storage_mb,
      features, features_modules, is_active, sort_order,
      currency,
    } = body;

    if (!code || typeof code !== 'string' || !SAFE_CODE.test(code)) {
      return error('كود الباقة غير صالح (أحرف/أرقام/شرطات فقط، 2-32)');
    }
    if (!name || typeof name !== 'string' || name.trim().length > 120) {
      return error('اسم الباقة مطلوب (حتى 120 حرف)');
    }

    const insertData: any = {
      code: code.trim().toLowerCase(),
      name: name.trim(),
      description: typeof description === 'string' ? description.slice(0, 500) : '',
      description_ar: typeof description_ar === 'string' ? description_ar.slice(0, 500) : '',
      currency: typeof currency === 'string' && /^[A-Z]{3}$/.test(currency) ? currency : 'USD',
      price_monthly: normInt(priceMonthly ?? price_monthly, 0) || 0,
      price_yearly: normInt(priceYearly ?? price_yearly),
      yearly_discount_percent: normInt(yearly_discount_percent, 20) ?? 20,
      trial_days: normInt(trial_days, 14) ?? 14,
      max_users: normInt(maxUsers ?? max_users, 1) ?? 1,
      max_clients: normInt(max_clients, null),
      max_suppliers: normInt(max_suppliers, null),
      max_employees: normInt(max_employees, null),
      max_projects: normInt(maxProjects ?? max_projects, null),
      max_invoices_per_month: normInt(max_invoices_per_month, 100),
      max_quotations_per_month: normInt(max_quotations_per_month, 50),
      max_storage_mb: normInt(max_storage_mb, 0) ?? 0,
      features: features ? (typeof features === 'string' ? features : JSON.stringify(features)) : '[]',
      features_modules: features_modules
        ? (typeof features_modules === 'string' ? features_modules : JSON.stringify(features_modules))
        : '{}',
      is_active: is_active !== undefined ? Boolean(is_active) : true,
      sort_order: normInt(sort_order, 0) ?? 0,
    };

    const s = sb();
    const { data, error: insertErr } = await s.from('subscription_plans')
      .insert(insertData)
      .select()
      .single();

    if (insertErr) {
      console.error('Insert plan error:', insertErr);
      return error('فشل إضافة الباقة: ' + insertErr.message, 500);
    }
    return success(data, 201);
  } catch (e: any) {
    console.error('Plans POST error:', e);
    return adminJsonError(e);
  }
}
