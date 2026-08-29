import { NextRequest } from 'next/server';
import { success, error, notFound, handleApiError, parseBody, requireModulePermission } from '@/lib/api-helpers';
import { getSupabase } from '@/lib/supabase-client';
import { contractUpdateSchema, relationshipUuid } from '@/lib/relationship-validation';

const sb = () => getSupabase();

export async function GET(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const auth = await requireModulePermission(request, 'contracts', 'read');
    const { id } = await params;
    if (!relationshipUuid.safeParse(id).success) return error('معرف العقد غير صالح');
    const s = sb();
    const { data: contract, error: contractError } = await s.from('contracts').select('*, projects(name), contacts(name)')
      .eq('id', id).eq('company_id', auth.companyId).maybeSingle();
    if (contractError) throw contractError;
    if (!contract) return notFound();
    const row = contract as Record<string, unknown>;
    const project = row.projects as { name?: string } | null;
    const contact = row.contacts as { name?: string } | null;
    return success({
      ...row,
      project_name: project?.name || null,
      contact_name: contact?.name || null,
    });
  } catch (err) {
    return handleApiError(err);
  }
}

export async function PUT(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const auth = await requireModulePermission(request, 'contracts', 'update');
    const { id } = await params;
    if (!relationshipUuid.safeParse(id).success) return error('معرف العقد غير صالح');
    const parsed = contractUpdateSchema.safeParse(await parseBody(request));
    if (!parsed.success) return error(parsed.error.issues[0].message);
    const { data, error: updateError } = await sb().rpc('update_contract_atomic', {
      p_company_id: auth.companyId,
      p_contract_id: id,
      p_patch: parsed.data,
      p_user_id: auth.userId,
    });
    if (updateError) {
      const message = String(updateError.message || '');
      if (message.includes('غير موجود')) return notFound();
      if (message.includes('لا يمكن') || message.includes('انتقال حالة')) return error(message, 409);
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
    const auth = await requireModulePermission(request, 'contracts', 'delete');
    const { id } = await params;
    if (!relationshipUuid.safeParse(id).success) return error('معرف العقد غير صالح');
    const s = sb();
    const { data, error: deleteError } = await s.rpc('delete_draft_contract_atomic', {
      p_company_id: auth.companyId,
      p_contract_id: id,
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
