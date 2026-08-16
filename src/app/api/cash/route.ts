import { NextRequest } from 'next/server';
import { z } from 'zod';
import { success, error, requireModulePermission, handleApiError, getPaginationParams, getDateRangeParams, parseBody } from '@/lib/api-helpers';
import { getSupabase } from '@/lib/supabase-client';
import { isValidDate } from '@/lib/utils';

const sb = () => getSupabase();
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const cashSchema = z.object({
  date: z.string().refine(isValidDate, 'تاريخ الحركة غير صالح'),
  type: z.enum(['receipt', 'revenue', 'expense'], { message: 'نوع الحركة يجب أن يكون قبضاً أو صرفاً' }),
  amount: z.number().finite().positive('المبلغ يجب أن يكون أكبر من صفر')
    .refine((value) => Math.abs(value * 100 - Math.round(value * 100)) < 1e-8, 'المبلغ يجب ألا يتجاوز منزلتين'),
  accountId: z.string().uuid('الحساب المقابل غير صالح').nullable().optional(),
  categoryId: z.string().uuid('تصنيف الحركة غير صالح').nullable().optional(),
  bankSafeId: z.string().uuid('الخزينة أو البنك غير صالح'),
  contactId: z.string().uuid('الطرف غير صالح').nullable().optional(),
  projectId: z.string().uuid('المشروع غير صالح').nullable().optional(),
  reason: z.string().trim().min(1, 'سبب الحركة مطلوب').max(1000),
  description: z.string().trim().max(2000).optional(),
  tax_rate: z.number().finite().min(0).max(1)
    .refine((value) => Math.abs(value * 10000 - Math.round(value * 10000)) < 1e-8, 'نسبة الضريبة غير صالحة').optional(),
  tax_enabled: z.boolean().optional(),
}).strict();
const COLUMNS = `id, date, type, amount, account_id, bank_safe_id, contact_id, project_id, category_id,
  reason, journal_entry_id, created_by, tax_rate, tax_amount, status, created_at,
  accounts!account_id(name), transaction_categories!category_id(name), banks_safes!bank_safe_id(name), contacts!contact_id(name)`;

export async function GET(request: NextRequest) {
  try {
    const auth = await requireModulePermission(request, 'cash', 'read');
    const url = new URL(request.url);
    const { page, pageSize } = getPaginationParams(url);
    const { from, to } = getDateRangeParams(url);
    const type = url.searchParams.get('type');
    const accountId = url.searchParams.get('account_id');
    const contactId = url.searchParams.get('contact_id');
    const bankSafeId = url.searchParams.get('bank_safe_id');
    if (type && !['receipt', 'revenue', 'expense'].includes(type)) return error('نوع الحركة غير صالح');
    for (const value of [accountId, contactId, bankSafeId]) if (value && !UUID_RE.test(value)) return error('معرّف الفلتر غير صالح');
    if ((from && !isValidDate(from)) || (to && !isValidDate(to)) || (from && to && from > to)) return error('فترة البحث غير صالحة');

    let query = sb().from('cash_transactions').select(COLUMNS, { count: 'exact' })
      .eq('company_id', auth.companyId).neq('status', 'cancelled');
    if (from) query = query.gte('date', from);
    if (to) query = query.lte('date', to);
    if (type) query = query.eq('type', type === 'receipt' ? 'revenue' : type);
    if (accountId) query = query.eq('account_id', accountId);
    if (contactId) query = query.eq('contact_id', contactId);
    if (bankSafeId) query = query.eq('bank_safe_id', bankSafeId);
    const offset = (page - 1) * pageSize;
    const { data, error: queryError, count } = await query.order('date', { ascending: false })
      .order('created_at', { ascending: false }).range(offset, offset + pageSize - 1);
    if (queryError) throw queryError;
    const transactions = (data || []).map((row: Record<string, unknown>) => ({
      ...row,
      account_name: (row.accounts as { name?: string } | null)?.name || null,
      category_name: (row.transaction_categories as { name?: string } | null)?.name || null,
      bank_name: (row.banks_safes as { name?: string } | null)?.name || null,
      contact_name: (row.contacts as { name?: string } | null)?.name || null,
      accounts: undefined, transaction_categories: undefined, banks_safes: undefined, contacts: undefined,
    }));
    return success({ transactions, rows: transactions, total: count || 0, page, pageSize,
      totalPages: Math.ceil((count || 0) / pageSize) });
  } catch (err) {
    return handleApiError(err);
  }
}

export async function POST(request: NextRequest) {
  try {
    const auth = await requireModulePermission(request, 'cash', 'create');
    const parsed = cashSchema.safeParse(await parseBody(request));
    if (!parsed.success) return error(parsed.error.issues[0].message);
    const value = parsed.data;
    const { data, error: postError } = await sb().rpc('post_cash_transaction', {
      p_company_id: auth.companyId,
      p_date: value.date,
      p_type: value.type === 'receipt' ? 'revenue' : value.type,
      p_amount: value.amount,
      p_account_id: value.accountId || null,
      p_category_id: value.categoryId || null,
      p_bank_safe_id: value.bankSafeId,
      p_contact_id: value.contactId || null,
      p_project_id: value.projectId || null,
      p_reason: value.reason,
      p_description: value.description || '',
      p_tax_rate: value.tax_enabled ? value.tax_rate || 0 : 0,
      p_created_by: auth.userId,
    });
    const message = String(postError?.message || '');
    if (message.includes('غير موجود') || message.includes('غير صالحة أو بلا حساب')) return error(message, 404);
    if (message.includes('الرصيد غير كاف')) return error(message, 409);
    if (postError) throw postError;
    return success(data, 201);
  } catch (err) {
    return handleApiError(err);
  }
}
