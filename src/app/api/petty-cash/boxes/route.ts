import { NextRequest } from 'next/server';
import { z } from 'zod';
import { success, error, handleApiError, requireModulePermission, parseBody } from '@/lib/api-helpers';
import { getSupabase } from '@/lib/supabase-client';
import { companyMoneyParts } from '@/lib/company-money';

const sb = () => getSupabase();
const money = z.number().finite().nonnegative()
  .refine((value) => Math.abs(value * 100 - Math.round(value * 100)) < 1e-8, 'القيمة يجب ألا تتجاوز منزلتين');
const createSchema = z.object({
  name: z.string().trim().min(1, 'اسم الصندوق مطلوب').max(200),
  initial_balance: money.optional().default(0),
  daily_limit: money.optional().default(5000),
  currency: z.string().trim().toUpperCase().regex(/^[A-Z]{3}$/, 'رمز العملة غير صالح').optional(),
  custodian_id: z.string().uuid('أمين الصندوق غير صالح').nullable().optional(),
  notes: z.string().trim().max(1000).nullable().optional(),
  account_id: z.string().uuid('حساب الصندوق غير صالح').nullable().optional(),
  funding_account_id: z.string().uuid('حساب التمويل غير صالح').nullable().optional(),
}).strict();
const actionSchema = z.object({
  box_id: z.string().uuid('الصندوق غير صالح'),
  action: z.enum(['reconcile', 'close'], { message: 'عملية غير صالحة' }),
  physical_count: money.optional(),
  notes: z.string().trim().max(1000).optional(),
}).strict();

export async function POST(request: NextRequest) {
  try {
    const auth = await requireModulePermission(request, 'petty_cash', 'create');
    const parsed = createSchema.safeParse(await parseBody(request));
    if (!parsed.success) return error(parsed.error.issues[0].message);
    const value = parsed.data;
    let currency = value.currency;
    if (!currency) {
      const { data: companyMoney } = await sb()
        .from('companies')
        .select('currency_code, currency_symbol, country_code, locale')
        .eq('id', auth.companyId)
        .maybeSingle();
      currency = companyMoneyParts(companyMoney as {
        currency_code?: string; currency_symbol?: string; country_code?: string; locale?: string;
      } | null).code;
    }
    const { data, error: createError } = await sb().rpc('create_petty_cash_box', {
      p_company_id: auth.companyId,
      p_name: value.name,
      p_initial_balance: value.initial_balance,
      p_daily_limit: value.daily_limit,
      p_currency: currency,
      p_custodian_id: value.custodian_id || null,
      p_notes: value.notes || '',
      p_account_id: value.account_id || null,
      p_funding_account_id: value.funding_account_id || null,
      p_user_id: auth.userId,
    });
    const message = String(createError?.message || '');
    if (message.includes('غير صالح')) return error(message, 404);
    if (createError) throw createError;
    return success(data, 201);
  } catch (err) {
    return handleApiError(err);
  }
}

export async function PUT(request: NextRequest) {
  try {
    const auth = await requireModulePermission(request, 'petty_cash', 'update');
    const parsed = actionSchema.safeParse(await parseBody(request));
    if (!parsed.success) return error(parsed.error.issues[0].message);
    const value = parsed.data;
    if (value.action === 'reconcile') {
      if (value.physical_count === undefined) return error('الجرد الفعلي مطلوب');
      const { data, error: reconcileError } = await sb().rpc('reconcile_petty_cash_box', {
        p_company_id: auth.companyId,
        p_box_id: value.box_id,
        p_physical_count: value.physical_count,
        p_notes: value.notes || '',
        p_user_id: auth.userId,
      });
      const message = String(reconcileError?.message || '');
      if (message.includes('غير موجود')) return error('الصندوق غير موجود', 404);
      if (reconcileError) throw reconcileError;
      const row = (data || {}) as Record<string, unknown>;
      return success({ system_balance: Number(row.system_balance), physical_count: Number(row.physical_count),
        difference: Number(row.difference), status: row.status });
    }
    const { data, error: closeError } = await sb().rpc('close_petty_cash_box', {
      p_company_id: auth.companyId, p_box_id: value.box_id, p_user_id: auth.userId,
    });
    const message = String(closeError?.message || '');
    if (message.includes('غير موجود')) return error('الصندوق غير موجود', 404);
    if (message.includes('رصيد غير صفري')) return error(message, 409);
    if (closeError) throw closeError;
    return success({ closed: true, box: data });
  } catch (err) {
    return handleApiError(err);
  }
}
