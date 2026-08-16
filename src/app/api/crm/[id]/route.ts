import { NextRequest } from 'next/server';
import { success, error, notFound, parseBody, handleApiError, requireModulePermission } from '@/lib/api-helpers';
import { getSupabase } from '@/lib/supabase-client';
import { crmFollowupSchema, crmUpdateSchema, relationshipUuid } from '@/lib/relationship-validation';

const sb = () => getSupabase();

export async function GET(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const auth = await requireModulePermission(request, 'crm', 'read');
    const { id } = await params;
    if (!relationshipUuid.safeParse(id).success) return error('المعرف غير صالح');
    const s = sb();
    const { data: contact, error: contactError } = await s.from('crm_contacts').select('*')
      .eq('id', id).eq('company_id', auth.companyId).maybeSingle();
    if (contactError) throw contactError;
    if (!contact) return notFound();
    const { data: followups, error: followupsError } = await s.from('crm_followups').select('*')
      .eq('crm_contact_id', id).eq('company_id', auth.companyId).order('scheduled_at', { ascending: false });
    if (followupsError) throw followupsError;
    return success({
      ...contact,
      followups: followups || [],
      totalFollowups: (followups || []).length,
      upcomingFollowups: (followups || []).filter((item: Record<string, unknown>) =>
        new Date(String(item.scheduled_at)) >= new Date()).length,
    });
  } catch (err) {
    return handleApiError(err);
  }
}

export async function PUT(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const auth = await requireModulePermission(request, 'crm', 'update');
    const { id } = await params;
    if (!relationshipUuid.safeParse(id).success) return error('المعرف غير صالح');
    const parsed = crmUpdateSchema.safeParse(await parseBody(request));
    if (!parsed.success) return error(parsed.error.issues[0].message);
    const { data, error: updateError } = await sb().rpc('update_crm_contact_atomic', {
      p_company_id: auth.companyId,
      p_contact_id: id,
      p_patch: parsed.data,
      p_user_id: auth.userId,
    });
    if (updateError) {
      const message = String(updateError.message || '');
      if (message.includes('غير موجود')) return notFound();
      if (message.includes('انتقال مرحلة')) return error(message, 409);
      if (message.includes('غير صالحة')) return error(message);
      throw updateError;
    }
    return success(data);
  } catch (err) {
    return handleApiError(err);
  }
}

export async function DELETE(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const auth = await requireModulePermission(request, 'crm', 'delete');
    const { id } = await params;
    if (!relationshipUuid.safeParse(id).success) return error('المعرف غير صالح');
    const { data, error: deleteError } = await sb().rpc('delete_crm_contact_atomic', {
      p_company_id: auth.companyId,
      p_contact_id: id,
      p_user_id: auth.userId,
    });
    if (deleteError) {
      const message = String(deleteError.message || '');
      if (message.includes('غير موجود')) return notFound();
      if (message.includes('لا يمكن حذف')) return error(message, 409);
      throw deleteError;
    }
    return success(data);
  } catch (err) {
    return handleApiError(err);
  }
}

/** POST /api/crm/[id] — schedule a follow-up through an atomic parent check. */
export async function POST(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const auth = await requireModulePermission(request, 'crm', 'create');
    const { id } = await params;
    if (!relationshipUuid.safeParse(id).success) return error('المعرف غير صالح');
    const parsed = crmFollowupSchema.safeParse(await parseBody(request));
    if (!parsed.success) return error(parsed.error.issues[0].message);
    const { data, error: createError } = await sb().rpc('create_crm_followup_atomic', {
      p_company_id: auth.companyId,
      p_contact_id: id,
      p_payload: parsed.data,
      p_user_id: auth.userId,
    });
    if (createError) {
      const message = String(createError.message || '');
      if (message.includes('غير موجود')) return notFound();
      if (message.includes('غير صالحة')) return error(message);
      throw createError;
    }
    return success(data, 201);
  } catch (err) {
    return handleApiError(err);
  }
}
