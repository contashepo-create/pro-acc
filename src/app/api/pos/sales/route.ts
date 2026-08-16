import { NextRequest } from 'next/server';
import { z } from 'zod';
import { getSupabase } from '@/lib/supabase-client';
import { handleApiError, success, error, parseBody, requireModulePermission, getPaginationParams } from '@/lib/api-helpers';

const sb = () => getSupabase();
const saleSchema = z.object({
  terminal_id: z.string().uuid('طرفية نقطة البيع غير صالحة'),
  total: z.number().finite().positive('إجمالي البيع غير صالح')
    .refine((value) => Math.abs(value * 100 - Math.round(value * 100)) < 1e-8, 'إجمالي البيع يجب ألا يتجاوز منزلتين'),
  payment_method: z.enum(['cash', 'card', 'transfer'], { message: 'طريقة الدفع غير صالحة' }).optional().default('cash'),
}).strict();
const COLUMNS = 'id, branch_id, terminal_id, number, date, time, subtotal, tax_amount, discount_amount, total, payment_method, status, cashier_id, journal_entry_id, created_at, pos_terminals!terminal_id(name, code)';

export async function GET(req: NextRequest) {
  try {
    const auth = await requireModulePermission(req, 'pos', 'read');
    const { page, pageSize } = getPaginationParams(req.url);
    const offset = (page - 1) * pageSize;
    const { data, error: queryError, count } = await sb().from('pos_sales')
      .select(COLUMNS, { count: 'exact' }).eq('company_id', auth.companyId)
      .order('date', { ascending: false }).order('created_at', { ascending: false })
      .range(offset, offset + pageSize - 1);
    if (queryError) throw queryError;
    const sales = (data || []).map((row: Record<string, unknown>) => ({
      ...row,
      terminal_name: (row.pos_terminals as { name?: string } | null)?.name || null,
      terminal_code: (row.pos_terminals as { code?: string } | null)?.code || null,
      pos_terminals: undefined,
    }));
    return success({ sales, total: count || 0, page, pageSize });
  } catch (err) {
    return handleApiError(err);
  }
}

export async function POST(req: NextRequest) {
  try {
    const auth = await requireModulePermission(req, 'pos', 'create');
    const parsed = saleSchema.safeParse(await parseBody(req));
    if (!parsed.success) return error(parsed.error.issues[0].message);
    const value = parsed.data;
    const { data, error: createError } = await sb().rpc('create_pos_sale_atomic', {
      p_company_id: auth.companyId,
      p_terminal_id: value.terminal_id,
      p_total: value.total,
      p_payment_method: value.payment_method,
      p_user_id: auth.userId,
    });
    const message = String(createError?.message || '');
    if (message.includes('طرفية') || message.includes('خزينة تسوية')) return error(message, 404);
    if (createError) throw createError;
    return success(data, 201);
  } catch (err) {
    return handleApiError(err);
  }
}
