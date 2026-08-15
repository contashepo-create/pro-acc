import { NextRequest } from 'next/server';
import { success, notFound, requireApiAuth, handleApiError, parseBody } from '@/lib/api-helpers';
import { getSupabase } from '@/lib/supabase-client';

const sb = () => getSupabase();

/**
 * DELETE /api/complaints/[id]
 * حذف شكوى/اقتراح خاص بالشركة المسجلة (عزل مستأجر صارم).
 */
export async function DELETE(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { companyId } = await requireApiAuth(request);
    const { id } = await params;
    const s = sb();

    const { data: existing } = await s.from('complaints')
      .select('id')
      .eq('id', id)
      .eq('company_id', companyId)
      .maybeSingle();

    if (!existing) return notFound();

    const { error: delErr } = await s.from('complaints')
      .delete()
      .eq('id', id)
      .eq('company_id', companyId);

    if (delErr) throw delErr;
    return success({ deleted: true });
  } catch (err) {
    return handleApiError(err);
  }
}

/**
 * PATCH /api/complaints/[id]
 * تعديل الموضوع/النص (أو إغلاق الشكوى) — للشركة المالكة فقط.
 */
export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { companyId } = await requireApiAuth(request);
    const { id } = await params;
    const s = sb();
    const body = await parseBody<any>(request);

    const { data: existing } = await s.from('complaints')
      .select('id')
      .eq('id', id)
      .eq('company_id', companyId)
      .maybeSingle();

    if (!existing) return notFound();

    const update: Record<string, unknown> = { updated_at: new Date().toISOString() };
    if (typeof body.subject === 'string' && body.subject.trim() && body.subject.length <= 200) update.subject = body.subject.trim();
    if (typeof body.body === 'string' && body.body.trim() && body.body.length <= 5000) update.body = body.body.trim();
    // read/replied are administrative workflow states; a tenant may only
    // close its own ticket, never impersonate an admin reply.
    if (body.status === 'closed') update.status = 'closed';

    const { data: updated, error: updErr } = await s.from('complaints')
      .update(update)
      .eq('id', id)
      .eq('company_id', companyId)
      .select('id, type, subject, body, status, admin_reply, created_at, updated_at')
      .single();

    if (updErr) throw updErr;
    return success(updated);
  } catch (err) {
    return handleApiError(err);
  }
}
