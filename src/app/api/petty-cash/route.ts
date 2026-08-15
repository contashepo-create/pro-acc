import { NextRequest } from 'next/server';
import { success, error, handleApiError, getPaginationParams, requireModulePermission, parseBody } from '@/lib/api-helpers';
import { getSupabase } from '@/lib/supabase-client';
import { generateId } from '@/lib/utils';

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

    const { data: boxes } = await boxQuery;

    // Get transactions
    let txQuery = s.from('petty_cash_transactions')
      .select('*, petty_cash_boxes(name)')
      .eq('company_id', auth.companyId);

    if (boxId) txQuery = txQuery.eq('box_id', boxId);

    const offset = (page - 1) * pageSize;
    const { data: transactions, error: qErr, count } = await txQuery
      .order('date', { ascending: false })
      .range(offset, offset + pageSize - 1);

    if (qErr) throw qErr;

    // Calculate current balance for each box
    const boxesWithBalance = await Promise.all((boxes || []).map(async (box: any) => {
      const { data: txs } = await s.from('petty_cash_transactions')
        .select('type, amount')
        .eq('company_id', auth.companyId)
        .eq('box_id', box.id);

      const inflow = (txs || [])
        .filter((t: any) => t.type === 'deposit')
        .reduce((sum: number, t: any) => sum + (parseFloat(t.amount) || 0), 0);
      const outflow = (txs || [])
        .filter((t: any) => t.type === 'withdrawal')
        .reduce((sum: number, t: any) => sum + (parseFloat(t.amount) || 0), 0);

      return {
        ...box,
        current_balance: parseFloat(box.initial_balance || 0) + inflow - outflow,
      };
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

    // عزل مستأجرين: الصندوق والمشروع (إن وُجد) يجب أن ينتميا لهذه الشركة
    const { data: box } = await s.from('petty_cash_boxes')
      .select('id, daily_limit')
      .eq('id', body.box_id)
      .eq('company_id', auth.companyId)
      .maybeSingle();
    if (!box) return error('الصندوق غير موجود', 404);

    if (body.project_id) {
      const { data: proj } = await s.from('projects')
        .select('id').eq('id', body.project_id).eq('company_id', auth.companyId).maybeSingle();
      if (!proj) return error('المشروع غير موجود', 404);
    }

    // Check daily limit for withdrawals
    if (body.type === 'withdrawal') {
      const today = new Date().toISOString().split('T')[0];
      const { data: todayTxs } = await s.from('petty_cash_transactions')
        .select('amount')
        .eq('company_id', auth.companyId)
        .eq('box_id', body.box_id)
        .eq('type', 'withdrawal')
        .eq('date', today);

      const todayTotal = (todayTxs || []).reduce((sum: number, t: any) => sum + (parseFloat(t.amount) || 0), 0);

      const limit = parseFloat((box as any).daily_limit || 0);
      if (limit > 0 && todayTotal + amount > limit) {
        return error(`تجاوزت الحد اليومي للسحب (${limit} ر.س). المتبقي اليوم: ${(limit - todayTotal).toFixed(2)} ر.س`);
      }
      const { data: allTxs } = await s.from('petty_cash_transactions')
        .select('type, amount').eq('company_id', auth.companyId).eq('box_id', body.box_id);
      const deposits = (allTxs || []).filter((t: any) => t.type === 'deposit').reduce((sum: number, t: any) => sum + (Number(t.amount) || 0), 0);
      const withdrawals = (allTxs || []).filter((t: any) => t.type === 'withdrawal').reduce((sum: number, t: any) => sum + (Number(t.amount) || 0), 0);
      const available = (Number((box as any).initial_balance) || 0) + deposits - withdrawals;
      if (amount > available + 0.005) return error('رصيد الصندوق غير كافٍ للسحب');
    }

    const txId = generateId();
    const { data, error: insertErr } = await s.from('petty_cash_transactions')
      .insert({
        id: txId,
        company_id: auth.companyId,
        box_id: body.box_id,
        type: body.type,
        amount,
        reason: body.reason,
        category: body.category || 'general', // general, transport, supplies, meals, misc
        project_id: body.project_id || null,
        receipt_url: body.receipt_url || null,
        reference_number: body.reference_number || null,
        date: body.date || today(),
        created_by: auth.userId,
      })
      .select('*, petty_cash_boxes(name)')
      .single();

    if (insertErr) throw insertErr;
    return success(data, 201);
  } catch (err) {
    return handleApiError(err);
  }
}

function today(): string {
  return new Date().toISOString().split('T')[0];
}
