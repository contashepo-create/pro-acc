import { NextRequest } from 'next/server';
import { success, error, requireApiAuth, handleApiError, getPaginationParams } from '@/lib/api-helpers';
import { getSupabase } from '@/lib/supabase-client';
import { generateId } from '@/lib/utils';

const sb = () => getSupabase();

/**
 * GET /api/petty-cash — List petty cash transactions + balance
 */
export async function GET(request: NextRequest) {
  try {
    const auth = await requireApiAuth(request);
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
    const auth = await requireApiAuth(request);
    const s = sb();
    const body = await request.json();

    if (!body.box_id || !body.type || !body.amount || !body.reason) {
      return error('الصندوق والنوع والمبلغ والسبب مطلوبة');
    }

    if (!['deposit', 'withdrawal'].includes(body.type)) {
      return error('النوع يجب أن يكون deposit أو withdrawal');
    }

    if (body.amount <= 0) {
      return error('المبلغ يجب أن يكون أكبر من صفر');
    }

    // Check daily limit for withdrawals
    if (body.type === 'withdrawal') {
      const today = new Date().toISOString().split('T')[0];
      const { data: todayTxs } = await s.from('petty_cash_transactions')
        .select('amount')
        .eq('box_id', body.box_id)
        .eq('type', 'withdrawal')
        .eq('date', today);

      const todayTotal = (todayTxs || []).reduce((sum: number, t: any) => sum + (parseFloat(t.amount) || 0), 0);
      const { data: box } = await s.from('petty_cash_boxes')
        .select('daily_limit')
        .eq('id', body.box_id)
        .maybeSingle();

      if (box) {
        const limit = parseFloat((box as any).daily_limit || 0);
        if (limit > 0 && todayTotal + body.amount > limit) {
          return error(`تجاوزت الحد اليومي للسحب (${limit} ر.س). المتبقي اليوم: ${(limit - todayTotal).toFixed(2)} ر.س`);
        }
      }
    }

    const txId = generateId();
    const { data, error: insertErr } = await s.from('petty_cash_transactions')
      .insert({
        id: txId,
        company_id: auth.companyId,
        box_id: body.box_id,
        type: body.type,
        amount: body.amount,
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
