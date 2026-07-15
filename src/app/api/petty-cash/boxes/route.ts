import { NextRequest } from 'next/server';
import { success, error, requireApiAuth, handleApiError } from '@/lib/api-helpers';
import { getSupabase } from '@/lib/supabase-client';
import { generateId } from '@/lib/utils';

const sb = () => getSupabase();

/**
 * POST /api/petty-cash/boxes — Create a new petty cash box
 */
export async function POST(request: NextRequest) {
  try {
    const auth = await requireApiAuth(request);
    const s = sb();
    const body = await request.json();

    if (!body.name) return error('اسم الصندوق مطلوب');

    const boxId = generateId();
    const { data, error: insertErr } = await s.from('petty_cash_boxes')
      .insert({
        id: boxId,
        company_id: auth.companyId,
        name: body.name,
        initial_balance: body.initial_balance || 0,
        daily_limit: body.daily_limit || 5000,
        currency: body.currency || 'SAR',
        custodian_id: body.custodian_id || null,
        notes: body.notes || null,
        is_active: true,
        created_by: auth.userId,
        created_at: new Date().toISOString(),
      })
      .select()
      .single();

    if (insertErr) throw insertErr;
    return success(data, 201);
  } catch (err) {
    return handleApiError(err);
  }
}

/**
 * POST /api/petty-cash/boxes — with action=reconcile for reconciliation
 */
export async function PUT(request: NextRequest) {
  try {
    const auth = await requireApiAuth(request);
    const s = sb();
    const body = await request.json();
    const { box_id, action, physical_count } = body;

    if (!box_id) return error('box_id مطلوب');

    if (action === 'reconcile') {
      // Calculate system balance
      const { data: box } = await s.from('petty_cash_boxes')
        .select('initial_balance')
        .eq('id', box_id)
        .eq('company_id', auth.companyId)
        .maybeSingle();

      if (!box) return error('الصندوق غير موجود');

      const { data: txs } = await s.from('petty_cash_transactions')
        .select('type, amount')
        .eq('box_id', box_id);

      const inflow = (txs || [])
        .filter((t: any) => t.type === 'deposit')
        .reduce((sum: number, t: any) => sum + (parseFloat(t.amount) || 0), 0);
      const outflow = (txs || [])
        .filter((t: any) => t.type === 'withdrawal')
        .reduce((sum: number, t: any) => sum + (parseFloat(t.amount) || 0), 0);

      const systemBalance = parseFloat((box as any).initial_balance || 0) + inflow - outflow;
      const physical = parseFloat(physical_count || 0);
      const difference = physical - systemBalance;

      // Log reconciliation
      const reconId = generateId();
      await s.from('petty_cash_reconciliation').insert({
        id: reconId,
        company_id: auth.companyId,
        box_id,
        reconciliation_date: new Date().toISOString().split('T')[0],
        system_balance: systemBalance,
        physical_count: physical,
        difference,
        status: Math.abs(difference) < 0.01 ? 'balanced' : 'discrepancy',
        notes: body.notes || null,
        reconciled_by: auth.userId,
        created_at: new Date().toISOString(),
      });

      return success({
        system_balance: systemBalance,
        physical_count: physical,
        difference,
        status: Math.abs(difference) < 0.01 ? 'balanced' : 'discrepancy',
      });
    }

    if (action === 'close') {
      await s.from('petty_cash_boxes')
        .update({ is_active: false, updated_at: new Date().toISOString() })
        .eq('id', box_id)
        .eq('company_id', auth.companyId);
      return success({ closed: true });
    }

    return error('عملية غير صالحة');
  } catch (err) {
    return handleApiError(err);
  }
}
