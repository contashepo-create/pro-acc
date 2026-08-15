import { NextRequest } from 'next/server';
import { success, error, handleApiError, getPaginationParams, requireModulePermission, parseBody } from '@/lib/api-helpers';
import { getSupabase } from '@/lib/supabase-client';

const sb = () => getSupabase();

/**
 * GET /api/petty-cash — List petty cash transactions + balance
 */
export async function GET(request: NextRequest) {
  try {
    const auth = await requireModulePermission(request, 'petty_cash', 'read');
    const s = sb();
    const url = new URL(request.url);
    const { page, pageSize } = getPaginationParams(url);
    const boxId = url.searchParams.get('box_id');

    // Get all petty cash boxes
    let boxQuery = s.from('petty_cash_boxes')
      .select('*')
      .eq('company_id', auth.companyId);

    if (boxId) boxQuery = boxQuery.eq('id', boxId);

    const { data: boxes, error: boxesErr } = await boxQuery;
    if (boxesErr) throw boxesErr;

    // Get transactions
    let txQuery = s.from('petty_cash_transactions')
      .select('*, petty_cash_boxes(name)', { count: 'exact' })
      .eq('company_id', auth.companyId);

    if (boxId) txQuery = txQuery.eq('box_id', boxId);

    const offset = (page - 1) * pageSize;
    const { data: transactions, error: qErr, count } = await txQuery
      .order('date', { ascending: false })
      .range(offset, offset + pageSize - 1);

    if (qErr) throw qErr;

    // Aggregate in PostgreSQL so balances are not truncated by API row limits.
    const { data: balances, error: balanceErr } = await s.rpc('get_petty_cash_balances', {
      p_company_id: auth.companyId,
      p_box_id: boxId || null,
    });
    if (balanceErr) throw balanceErr;
    const balanceMap = new Map((balances || []).map((row: any) => [row.box_id, Number(row.current_balance) || 0]));
    const boxesWithBalance = (boxes || []).map((box: any) => ({
      ...box,
      current_balance: balanceMap.get(box.id) ?? Number(box.initial_balance || 0),
    }));

    return success({
      boxes: boxesWithBalance,
      transactions: transactions || [],
      total: count || 0,
      page,
      pageSize,
    });
  } catch (err) {
    return handleApiError(err);
  }
}

/**
 * POST /api/petty-cash — Record a petty cash transaction
 */
export async function POST(request: NextRequest) {
  try {
    const auth = await requireModulePermission(request, 'petty_cash', 'create');
    const s = sb();
    const body = await parseBody<Record<string, any>>(request);

    if (!body.box_id || !body.type || !body.amount || !body.reason) {
      return error('الصندوق والنوع والمبلغ والسبب مطلوبة');
    }

    if (!['deposit', 'withdrawal'].includes(body.type)) {
      return error('النوع يجب أن يكون deposit أو withdrawal');
    }

    const amount = Number(body.amount);
    if (!Number.isFinite(amount) || amount <= 0 || Math.abs(amount * 100 - Math.round(amount * 100)) > 1e-8) {
      return error('المبلغ غير صالح');
    }

    const date = body.date || today();
    if (!/^\d{4}-\d{2}-\d{2}$/.test(date) || typeof body.reason !== 'string' || body.reason.length > 1000 ||
        (body.receipt_url !== undefined && body.receipt_url !== null && typeof body.receipt_url !== 'string') ||
        (body.reference_number !== undefined && body.reference_number !== null && typeof body.reference_number !== 'string')) {
      return error('بيانات حركة الصندوق غير صالحة', 422);
    }

    // Box lock, tenant/project/account validation, daily limit, available
    // balance, transaction, journal and audit all commit atomically.
    const { data, error: postErr } = await s.rpc('post_petty_cash_transaction', {
      p_company_id: auth.companyId,
      p_box_id: body.box_id,
      p_type: body.type,
      p_amount: amount,
      p_reason: body.reason,
      p_category: body.category || 'general',
      p_project_id: body.project_id || null,
      p_receipt_url: body.receipt_url || '',
      p_reference_number: body.reference_number || '',
      p_date: date,
      p_counterpart_account_id: body.account_id || null,
      p_user_id: auth.userId,
    });
    if (postErr) throw postErr;
    return success(data, 201);
  } catch (err) {
    return handleApiError(err);
  }
}

function today(): string {
  return new Date().toISOString().split('T')[0];
}
