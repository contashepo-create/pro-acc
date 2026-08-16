import { NextRequest } from 'next/server';
import { success, error, notFound, handleApiError, parseBody, requireModulePermission } from '@/lib/api-helpers';
import { getSupabase } from '@/lib/supabase-client';
import { bondActionSchema, bondUpdateSchema, relationshipUuid } from '@/lib/relationship-validation';

const sb = () => getSupabase();

export async function GET(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const auth = await requireModulePermission(request, 'bonds', 'read');
    const { id } = await params;
    if (!relationshipUuid.safeParse(id).success) return error('معرف الضمان غير صالح');
    const { data: bond, error: queryError } = await sb().from('bonds').select('*, projects(name), contacts(name), tenders(title)')
      .eq('id', id).eq('company_id', auth.companyId).maybeSingle();
    if (queryError) throw queryError;
    if (!bond) return notFound();
    const row = bond as Record<string, unknown>;
    const project = row.projects as { name?: string } | null;
    const contact = row.contacts as { name?: string } | null;
    const tender = row.tenders as { title?: string } | null;
    const now = Date.now();
    return success({
      ...row,
      project_name: project?.name || null,
      contact_name: contact?.name || null,
      tender_title: tender?.title || null,
      daysUntilExpiry: row.expiry_date ? Math.max(0, Math.ceil((new Date(String(row.expiry_date)).getTime() - now) / 86400000)) : null,
      daysActive: row.issue_date ? Math.floor((now - new Date(String(row.issue_date)).getTime()) / 86400000) : null,
    });
  } catch (err) {
    return handleApiError(err);
  }
}

export async function PUT(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const auth = await requireModulePermission(request, 'bonds', 'update');
    const { id } = await params;
    if (!relationshipUuid.safeParse(id).success) return error('معرف الضمان غير صالح');
    const raw = await parseBody(request);
    const action = raw && typeof raw === 'object' && !Array.isArray(raw) ? (raw as Record<string, unknown>).action : undefined;
    if (action === 'release' || action === 'cancel') {
      const parsed = bondActionSchema.safeParse(raw);
      if (!parsed.success) return error(parsed.error.issues[0].message);
      const { data, error: transitionError } = await sb().rpc('transition_bond_atomic', {
        p_company_id: auth.companyId,
        p_bond_id: id,
        p_action: parsed.data.action,
        p_notes: parsed.data.notes || null,
        p_user_id: auth.userId,
      });
      if (transitionError) return bondMutationError(transitionError);
      return success(data);
    }

    const parsed = bondUpdateSchema.safeParse(raw);
    if (!parsed.success) return error(parsed.error.issues[0].message);
    const { data, error: updateError } = await sb().rpc('update_bond_atomic', {
      p_company_id: auth.companyId,
      p_bond_id: id,
      p_patch: parsed.data,
      p_user_id: auth.userId,
    });
    if (updateError) return bondMutationError(updateError);
    return success(data);
  } catch (err) {
    return handleApiError(err);
  }
}

/** DELETE preserves the guarantee record and performs an audited cancellation. */
export async function DELETE(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const auth = await requireModulePermission(request, 'bonds', 'delete');
    const { id } = await params;
    if (!relationshipUuid.safeParse(id).success) return error('معرف الضمان غير صالح');
    const { data, error: transitionError } = await sb().rpc('transition_bond_atomic', {
      p_company_id: auth.companyId,
      p_bond_id: id,
      p_action: 'cancel',
      p_notes: null,
      p_user_id: auth.userId,
    });
    if (transitionError) return bondMutationError(transitionError);
    return success({ cancelled: true, bond: data });
  } catch (err) {
    return handleApiError(err);
  }
}

function bondMutationError(mutationError: { message?: string | null }) {
  const message = String(mutationError.message || 'تعذر تنفيذ عملية الضمان');
  if (message.includes('غير موجود')) return notFound();
  if (message.includes('لا يمكن')) return error(message, 409);
  if (message.includes('غير صالحة')) return error(message);
  throw mutationError;
}
