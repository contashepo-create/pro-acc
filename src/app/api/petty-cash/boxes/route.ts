import { NextRequest } from 'next/server';
import { success, error, handleApiError, requireModulePermission, parseBody } from '@/lib/api-helpers';
import { getSupabase } from '@/lib/supabase-client';

const sb = () => getSupabase();

/** POST /api/petty-cash/boxes — create a ledger-linked petty-cash box. */
export async function POST(request: NextRequest) {
  try {
    const auth = await requireModulePermission(request, 'petty_cash', 'create');
    const body = await parseBody<Record<string, any>>(request);
    if (typeof body.name !== 'string' || !body.name.trim()) return error('اسم الصندوق مطلوب');
    const initialBalance = Number(body.initial_balance ?? 0);
    const dailyLimit = Number(body.daily_limit ?? 5000);
    if (![initialBalance, dailyLimit].every((value) => Number.isFinite(value) && value >= 0 && Math.abs(value * 100 - Math.round(value * 100)) < 1e-8)) {
      return error('الرصيد الافتتاحي أو الحد اليومي غير صالح', 422);
    }
    if ((body.notes !== undefined && body.notes !== null && typeof body.notes !== 'string') ||
        (body.currency !== undefined && typeof body.currency !== 'string')) return error('بيانات الصندوق غير صالحة', 422);

    // Account validation, optional opening journal, box creation and audit are
    // one transaction. account_id defaults to 1110 and opening funding to 3000.
    const { data, error: createErr } = await sb().rpc('create_petty_cash_box', {
      p_company_id: auth.companyId,
      p_name: body.name,
      p_initial_balance: initialBalance,
      p_daily_limit: dailyLimit,
      p_currency: body.currency || 'SAR',
      p_custodian_id: body.custodian_id || null,
      p_notes: body.notes || '',
      p_account_id: body.account_id || null,
      p_funding_account_id: body.funding_account_id || null,
      p_user_id: auth.userId,
    });
    if (createErr) throw createErr;
    return success(data, 201);
  } catch (err) {
    return handleApiError(err);
  }
}

/** PUT /api/petty-cash/boxes — reconcile or close a box atomically. */
export async function PUT(request: NextRequest) {
  try {
    const auth = await requireModulePermission(request, 'petty_cash', 'update');
    const body = await parseBody<Record<string, any>>(request);
    if (!body.box_id) return error('box_id مطلوب');
    const s = sb();

    if (body.action === 'reconcile') {
      const physical = Number(body.physical_count);
      if (!Number.isFinite(physical) || physical < 0 || Math.abs(physical * 100 - Math.round(physical * 100)) > 1e-8) {
        return error('الجرد الفعلي غير صالح', 422);
      }
      const { data, error: reconcileErr } = await s.rpc('reconcile_petty_cash_box', {
        p_company_id: auth.companyId,
        p_box_id: body.box_id,
        p_physical_count: physical,
        p_notes: typeof body.notes === 'string' ? body.notes : '',
        p_user_id: auth.userId,
      });
      if (reconcileErr) throw reconcileErr;
      const row = data as Record<string, any>;
      return success({
        system_balance: Number(row.system_balance),
        physical_count: Number(row.physical_count),
        difference: Number(row.difference),
        status: row.status,
      });
    }

    if (body.action === 'close') {
      const { error: closeErr } = await s.rpc('close_petty_cash_box', {
        p_company_id: auth.companyId,
        p_box_id: body.box_id,
        p_user_id: auth.userId,
      });
      if (closeErr) throw closeErr;
      return success({ closed: true });
    }
    return error('عملية غير صالحة');
  } catch (err) {
    return handleApiError(err);
  }
}
