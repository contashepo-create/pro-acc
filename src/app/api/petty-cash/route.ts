import { NextRequest } from 'next/server';
import { z } from 'zod';
import { success, error, handleApiError, getPaginationParams, requireModulePermission, parseBody } from '@/lib/api-helpers';
import { getSupabase } from '@/lib/supabase-client';
import { isValidDate } from '@/lib/utils';

const sb = () => getSupabase();
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const transactionSchema = z.object({
  box_id: z.string().uuid('الصندوق غير صالح'),
  type: z.enum(['deposit', 'withdrawal'], { message: 'نوع حركة الصندوق غير صالح' }),
  amount: z.number().finite().positive('المبلغ غير صالح')
    .refine((value) => Math.abs(value * 100 - Math.round(value * 100)) < 1e-8, 'المبلغ يجب ألا يتجاوز منزلتين'),
  reason: z.string().trim().min(1, 'سبب الحركة مطلوب').max(1000),
  category: z.enum(['general', 'transport', 'supplies', 'meals', 'maintenance', 'misc']).optional().default('general'),
  project_id: z.string().uuid('المشروع غير صالح').nullable().optional(),
  receipt_url: z.string().trim().max(500).nullable().optional(),
  reference_number: z.string().trim().max(200).nullable().optional(),
  date: z.string().refine(isValidDate, 'تاريخ الحركة غير صالح').optional(),
  account_id: z.string().uuid('الحساب المقابل غير صالح').nullable().optional(),
}).strict();
const BOX_COLUMNS = 'id, name, initial_balance, daily_limit, currency, custodian_id, notes, is_active, created_by, account_id, opening_journal_entry_id, created_at, updated_at';
const TX_COLUMNS = 'id, box_id, type, amount, reason, category, project_id, receipt_url, reference_number, date, created_by, counterpart_account_id, journal_entry_id, status, created_at, petty_cash_boxes!box_id(name)';

export async function GET(request: NextRequest) {
  try {
    const auth = await requireModulePermission(request, 'petty_cash', 'read');
    const url = new URL(request.url);
    const { page, pageSize } = getPaginationParams(url);
    const boxId = url.searchParams.get('box_id');
    if (boxId && !UUID_RE.test(boxId)) return error('معرّف الصندوق غير صالح');
    let boxQuery = sb().from('petty_cash_boxes').select(BOX_COLUMNS).eq('company_id', auth.companyId);
    if (boxId) boxQuery = boxQuery.eq('id', boxId);
    const { data: boxes, error: boxesError } = await boxQuery.order('name').range(0, 499);
    if (boxesError) throw boxesError;

    let transactionQuery = sb().from('petty_cash_transactions').select(TX_COLUMNS, { count: 'exact' })
      .eq('company_id', auth.companyId);
    if (boxId) transactionQuery = transactionQuery.eq('box_id', boxId);
    const offset = (page - 1) * pageSize;
    const { data: transactionRows, error: queryError, count } = await transactionQuery
      .order('date', { ascending: false }).order('created_at', { ascending: false })
      .range(offset, offset + pageSize - 1);
    if (queryError) throw queryError;
    const { data: balances, error: balanceError } = await sb().rpc('get_petty_cash_balances', {
      p_company_id: auth.companyId, p_box_id: boxId || null,
    });
    if (balanceError) throw balanceError;
    const balanceMap = new Map((balances || []).map((row: Record<string, unknown>) => [
      String(row.box_id), Number(row.current_balance) || 0,
    ]));
    const boxesWithBalance = (boxes || []).map((box: Record<string, unknown>) => ({
      ...box, current_balance: balanceMap.get(String(box.id)) ?? Number(box.initial_balance || 0),
    }));
    const transactions = (transactionRows || []).map((row: Record<string, unknown>) => ({
      ...row, box_name: (row.petty_cash_boxes as { name?: string } | null)?.name || null,
      petty_cash_boxes: undefined,
    }));
    return success({ boxes: boxesWithBalance, transactions, total: count || 0, page, pageSize,
      boxesTruncated: (boxes || []).length === 500 });
  } catch (err) {
    return handleApiError(err);
  }
}

export async function POST(request: NextRequest) {
  try {
    const auth = await requireModulePermission(request, 'petty_cash', 'create');
    const parsed = transactionSchema.safeParse(await parseBody(request));
    if (!parsed.success) return error(parsed.error.issues[0].message);
    const value = parsed.data;
    if (value.receipt_url && !value.receipt_url.startsWith(`${auth.companyId}/`)) {
      return error('مرجع الإيصال لا ينتمي لمساحة الشركة', 403);
    }
    const { data, error: postError } = await sb().rpc('post_petty_cash_transaction', {
      p_company_id: auth.companyId,
      p_box_id: value.box_id,
      p_type: value.type,
      p_amount: value.amount,
      p_reason: value.reason,
      p_category: value.category,
      p_project_id: value.project_id || null,
      p_receipt_url: value.receipt_url || '',
      p_reference_number: value.reference_number || '',
      p_date: value.date || new Date().toISOString().slice(0, 10),
      p_counterpart_account_id: value.account_id || null,
      p_user_id: auth.userId,
    });
    const message = String(postError?.message || '');
    if (message.includes('غير موجود') || message.includes('غير صالح أو مغلق')) return error(message, 404);
    if (message.includes('تجاوز') || message.includes('غير كاف')) return error(message, 409);
    if (postError) throw postError;
    return success(data, 201);
  } catch (err) {
    return handleApiError(err);
  }
}
