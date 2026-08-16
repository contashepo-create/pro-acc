import { NextRequest } from 'next/server';
import { z } from 'zod';
import { success, error, parseBody, requireModulePermission, handleApiError } from '@/lib/api-helpers';
import { getSupabase } from '@/lib/supabase-client';
import { isValidDate } from '@/lib/utils';

const sb = () => getSupabase();
const money = z.number().finite().refine((value) => Math.abs(value * 100 - Math.round(value * 100)) < 1e-8,
  'المبلغ يجب ألا يتجاوز منزلتين');
const nonnegativeMoney = z.number().finite().nonnegative('مبلغ بند المطابقة لا يكون سالباً')
  .refine((value) => Math.abs(value * 100 - Math.round(value * 100)) < 1e-8, 'المبلغ يجب ألا يتجاوز منزلتين');
const reconciliationSchema = z.object({
  bankSafeId: z.string().uuid('معرّف البنك أو الخزينة غير صالح'),
  date: z.string().refine(isValidDate, 'تاريخ المطابقة غير صالح'),
  closingBalance: money,
  items: z.array(z.object({
    transactionType: z.string().trim().min(1, 'وصف بند المطابقة مطلوب').max(100),
    amount: nonnegativeMoney,
    date: z.string().refine(isValidDate, 'تاريخ بند المطابقة غير صالح').optional(),
    isCleared: z.boolean().optional(),
  }).strict()).max(1000, 'عدد بنود المطابقة يتجاوز الحد المسموح').optional().default([]),
}).strict();
const COLUMNS = 'id, bank_safe_id, date, closing_balance, system_balance, difference, status, created_by, completed_by, completed_at, created_at, banks_safes!bank_safe_id(name)';

export async function GET(req: NextRequest) {
  try {
    const auth = await requireModulePermission(req, 'banks', 'read');
    const { data, error: queryError } = await sb().from('bank_reconciliation')
      .select(COLUMNS).eq('company_id', auth.companyId).order('date', { ascending: false }).range(0, 499);
    if (queryError) throw queryError;
    const reconciliations = (data || []).map((row: Record<string, unknown>) => ({
      ...row,
      bank_safe_name: (row.banks_safes as { name?: string } | null)?.name || null,
      banks_safes: undefined,
    }));
    return success(reconciliations);
  } catch (err) {
    return handleApiError(err);
  }
}

export async function POST(req: NextRequest) {
  try {
    const auth = await requireModulePermission(req, 'banks', 'create');
    const parsed = reconciliationSchema.safeParse(await parseBody(req));
    if (!parsed.success) return error(parsed.error.issues[0].message);
    const value = parsed.data;
    const { data, error: createError } = await sb().rpc('create_bank_reconciliation', {
      p_company_id: auth.companyId,
      p_bank_safe_id: value.bankSafeId,
      p_date: value.date,
      p_closing_balance: value.closingBalance,
      p_items: value.items,
      p_user_id: auth.userId,
    });
    const message = String(createError?.message || '');
    if (message.includes('غير موجود')) return error('البنك أو الخزينة غير موجود', 404);
    if (message.includes('مطابقة لهذا البنك')) return error(message, 409);
    if (createError) throw createError;
    return success(data, 201);
  } catch (err) {
    return handleApiError(err);
  }
}
