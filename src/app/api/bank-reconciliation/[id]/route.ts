import { NextRequest } from 'next/server';
import { success, error, requireManagerOrAbove, handleApiError, requireModulePermission, parseBody } from '@/lib/api-helpers';
import { getSupabase } from '@/lib/supabase-client';

const sb = () => getSupabase();

export async function GET(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const auth = await requireModulePermission(req, 'banks', 'read');
    const { id } = await params;
    const s = sb();
    const { data: rec, error: recError } = await s.from('bank_reconciliation')
      .select('*').eq('id', id).eq('company_id', auth.companyId).maybeSingle();
    if (recError) throw recError;
    if (!rec) return error('Not found', 404);
    const { data: items, error: itemsErr } = await s.from('bank_reconciliation_items')
      .select('*').eq('reconciliation_id', id).eq('company_id', auth.companyId).order('date');
    if (itemsErr) throw itemsErr;
    return success({ ...rec, items: items || [] });
  } catch (e) { return handleApiError(e); }
}

export async function PUT(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const auth = await requireModulePermission(req, 'banks', 'update');
    const { id } = await params;
    const body = await parseBody<Record<string, any>>(req);
    let closing: number | null = null;
    if (body.closingBalance !== undefined) {
      closing = Number(body.closingBalance);
      if (!Number.isFinite(closing) || Math.abs(closing * 100 - Math.round(closing * 100)) > 1e-8) return error('الرصيد الختامي غير صالح');
    }
    if (body.status !== undefined && body.status !== 'completed') return error('الانتقال المسموح هو pending إلى completed فقط');
    if (closing === null && body.status === undefined) return error('لا توجد حقول قابلة للتعديل');

    // Locks pending state and refreshes the as-of ledger snapshot before update
    // or completion, preventing concurrent completion/edit races.
    const { data, error: updateErr } = await sb().rpc('update_bank_reconciliation', {
      p_company_id: auth.companyId,
      p_reconciliation_id: id,
      p_closing_balance: closing,
      p_complete: body.status === 'completed',
      p_user_id: auth.userId,
    });
    if (updateErr) {
      if (String(updateErr.message || '').includes('غير موجودة')) return error('Not found', 404);
      throw updateErr;
    }
    return success(data);
  } catch (e) { return handleApiError(e); }
}

export async function DELETE(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const auth = await requireManagerOrAbove(req);
    const { id } = await params;
    const { error: deleteErr } = await sb().rpc('delete_pending_bank_reconciliation', {
      p_company_id: auth.companyId,
      p_reconciliation_id: id,
      p_user_id: auth.userId,
    });
    if (deleteErr) {
      if (String(deleteErr.message || '').includes('غير موجودة')) return error('Not found', 404);
      throw deleteErr;
    }
    return success({ deleted: true });
  } catch (e) { return handleApiError(e); }
}
