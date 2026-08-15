import { NextRequest } from 'next/server';
import { getSupabase } from '@/lib/supabase-client';
import { handleApiError, success, error, parseBody, requireModulePermission } from '@/lib/api-helpers';

const sb = () => getSupabase() as any;

export async function GET(req: NextRequest) {
  try {
    const auth = await requireModulePermission(req, 'pos', 'read');
    const { data, error: queryError } = await sb().from('pos_sales')
      .select('*').eq('company_id', auth.companyId)
      .order('date', { ascending: false }).limit(50);
    if (queryError) throw queryError;
    return success({ sales: data || [] });
  } catch (err) {
    return handleApiError(err);
  }
}

export async function POST(req: NextRequest) {
  try {
    const auth = await requireModulePermission(req, 'pos', 'create');
    const body = await parseBody(req);
    const saleTotal = Number(body.total);
    if (!Number.isFinite(saleTotal) || saleTotal <= 0
      || Math.abs(saleTotal * 100 - Math.round(saleTotal * 100)) > 1e-8) {
      return error('إجمالي البيع غير صالح');
    }
    if (!body.terminal_id) return error('يجب اختيار طرفية نقطة بيع مربوطة بخزينة');
    const paymentMethod = String(body.payment_method || 'cash');
    if (!['cash', 'card', 'transfer'].includes(paymentMethod)) {
      return error('طريقة الدفع غير صالحة');
    }
    const { data, error: createError } = await sb().rpc('create_pos_sale_atomic', {
      p_company_id: auth.companyId,
      p_terminal_id: body.terminal_id,
      p_total: saleTotal,
      p_payment_method: paymentMethod,
      p_user_id: auth.userId,
    });
    if (createError) throw createError;
    return success(data, 201);
  } catch (err) {
    return handleApiError(err);
  }
}
