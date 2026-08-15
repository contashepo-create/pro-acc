import { NextRequest } from 'next/server';
import { success, error, notFound, requireModulePermission, requireManagerOrAbove, handleApiError } from '@/lib/api-helpers';
import { getSupabase } from '@/lib/supabase-client';

const sb = () => getSupabase();

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const auth = await requireModulePermission(request, 'cash', 'read');
    const { id } = await params;
    const s = sb();

    let { data, error: queryError } = await s.from('cash_transactions')
      .select('*, banks_safes(name), accounts(name), contacts(name), journal_entries(number)')
      .eq('id', id)
      .eq('company_id', auth.companyId)
      .maybeSingle();
    if (queryError) {
      const fallback = await s.from('cash_transactions')
        .select('*').eq('id', id).eq('company_id', auth.companyId).maybeSingle();
      data = fallback.data;
      queryError = fallback.error;
    }

    if (queryError || !data) {
      return notFound();
    }

    const ct = data as Record<string, any>;
    return success({
      ...ct,
      bank_safe_name: ct.banks_safes?.name || null,
      account_name: ct.accounts?.name || null,
      contact_name: ct.contacts?.name || null,
      journal_entry_number: ct.journal_entries?.number || null,
    });
  } catch (err) {
    return handleApiError(err);
  }
}

export async function PUT(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const auth = await requireModulePermission(request, 'cash', 'update');
    const { id } = await params;
    const s = sb();
    const body = await request.json();

    if (Object.keys(body).some((key) => key!=='reason')) {
      return error('الحركة المرحلة لا تقبل إلا تعديل البيان؛ اعكسها وسجل حركة جديدة لتغيير القيم المحاسبية');
    }
    if (typeof body.reason!=='string' || !body.reason.trim() || body.reason.length>1000) return error('البيان غير صالح');
    const { data: updated, error: rpcErr } = await s.rpc('update_cash_transaction_note', {
      p_company_id: auth.companyId,
      p_transaction_id: id,
      p_reason: body.reason.trim(),
      p_user_id: auth.userId,
    });
    if (rpcErr) throw rpcErr;
    return success(updated);
  } catch (err) {
    return handleApiError(err);
  }
}

export async function DELETE(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const auth = await requireManagerOrAbove(request);
    const { id } = await params;
    const s = sb();

    const { data: cancelled, error: rpcErr } = await s.rpc('cancel_cash_transaction', {
      p_company_id: auth.companyId,
      p_transaction_id: id,
      p_user_id: auth.userId,
    });
    if (rpcErr) throw rpcErr;
    return success(cancelled);
  } catch (err) {
    return handleApiError(err);
  }
}
