import { NextRequest } from 'next/server';
import { success, notFound, serverError, requireApiAuth, handleApiError, requireModulePermission } from '@/lib/api-helpers';
import { getSupabase } from '@/lib/supabase-client';

const sb = () => getSupabase();

export async function PATCH(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { companyId } = await requireModulePermission(request, 'messages', 'update');
    const { id } = await params;
    const s = sb();

    await s.from('messages')
      .update({ is_read: true })
      .eq('id', id)
      .eq('company_id', companyId);

    return success({ ok: true });
  } catch (err) {
    if (err instanceof Error && err.message === 'غير مصرح به') return handleApiError(err);
    return serverError(err);
  }
}

/**
 * DELETE /api/messages/[id]
 * حذف رسالة من صندوق الشركة (عزل مستأجر صارم).
 */
export async function DELETE(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { companyId } = await requireModulePermission(request, 'messages', 'delete');
    const { id } = await params;
    const s = sb();

    const { data: existing } = await s.from('messages')
      .select('id')
      .eq('id', id)
      .eq('company_id', companyId)
      .maybeSingle();

    if (!existing) return notFound();

    const { error: delErr } = await s.from('messages')
      .delete()
      .eq('id', id)
      .eq('company_id', companyId);

    if (delErr) throw delErr;
    return success({ deleted: true });
  } catch (err) {
    if (err instanceof Error && err.message === 'غير مصرح به') return handleApiError(err);
    return serverError(err);
  }
}
