import { NextRequest } from 'next/server';
import { success, error, handleApiError, requireModulePermission } from '@/lib/api-helpers';
import { getSupabase } from '@/lib/supabase-client';

const sb = () => getSupabase();
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export async function GET(req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  try {
    const auth = await requireModulePermission(req, 'purchase_invoices', 'read');
    const { id } = await ctx.params;
    if (!UUID_RE.test(id)) return error('معرّف المرتجع غير صالح');
    const s = sb();
    const { data: note, error: noteError } = await s.from('purchase_returns')
      .select('*').eq('id', id).eq('company_id', auth.companyId).maybeSingle();
    if (noteError) throw noteError;
    if (!note) return error('مرتجع المشتريات غير موجود', 404);
    const { data: items, error: itemsError } = await s.from('purchase_return_items')
      .select('*').eq('purchase_return_id', id).eq('company_id', auth.companyId).order('id');
    if (itemsError) throw itemsError;
    return success({ ...note, items: items || [] });
  } catch (err) {
    return handleApiError(err);
  }
}

export async function DELETE(req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  try {
    const auth = await requireModulePermission(req, 'purchase_invoices', 'delete');
    const { id } = await ctx.params;
    if (!UUID_RE.test(id)) return error('معرّف المرتجع غير صالح');
    const { data: cancelled, error: cancelError } = await sb().rpc('cancel_purchase_return_atomic', {
      p_company_id: auth.companyId,
      p_return_id: id,
      p_user_id: auth.userId,
    });
    if (cancelError) throw cancelError;
    return success(cancelled);
  } catch (err) {
    return handleApiError(err);
  }
}
