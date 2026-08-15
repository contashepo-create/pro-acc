import { NextRequest } from 'next/server';
import { success, error, notFound, parseBody, handleApiError, requireModulePermission } from '@/lib/api-helpers';
import { getSupabase } from '@/lib/supabase-client';

const sb = () => getSupabase();

export async function GET(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const auth = await requireModulePermission(req, 'progress_billing', 'read');
    const { id } = await params;
    const { data: claim, error: queryError } = await sb().from('progress_billing')
      .select('*, projects(name)').eq('id', id).eq('company_id', auth.companyId).maybeSingle();
    if (queryError) throw queryError;
    if (!claim) return notFound();
    const row = claim as Record<string, any>;
    return success({ ...row, project_name: row.projects?.name || null });
  } catch (err) {
    return handleApiError(err);
  }
}

export async function PUT(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const auth = await requireModulePermission(req, 'progress_billing', 'update');
    const { id } = await params;
    const body = await parseBody<Record<string, any>>(req);
    const s = sb();
    if (body.status === 'cancelled') {
      const { data: cancelled, error: cancelError } = await s.rpc('cancel_progress_billing_atomic', {
        p_company_id: auth.companyId,
        p_claim_id: id,
        p_user_id: auth.userId,
      });
      if (cancelError) throw cancelError;
      return success(cancelled);
    }
    if (body.status !== undefined) return error('انتقال حالة المستخلص غير صالح');
    const financialFields = ['date','gross_amount','retention_rate','retention_percentage','tax_rate','tax_amount','net_amount','project_id'];
    if (financialFields.some((field) => body[field] !== undefined)) {
      return error('لا يمكن تعديل القيم المالية لمستخلص مُرحّل. ألغِه وأنشئ مستخلصاً جديداً.', 409);
    }
    const claimNumber = typeof body.claim_number === 'string' ? body.claim_number.trim() : null;
    const description = typeof body.description === 'string' ? body.description
      : (typeof body.notes === 'string' ? body.notes : null);
    if (claimNumber === null && description === null && body.is_final === undefined) {
      return error('لا توجد تغييرات مسموحة');
    }
    const { data: updated, error: updateError } = await s.rpc('update_progress_billing_metadata', {
      p_company_id: auth.companyId,
      p_claim_id: id,
      p_claim_number: claimNumber,
      p_description: description,
      p_is_final: body.is_final === undefined ? null : Boolean(body.is_final),
      p_user_id: auth.userId,
    });
    if (updateError) throw updateError;
    return success(updated);
  } catch (err) {
    return handleApiError(err);
  }
}

export async function DELETE(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const auth = await requireModulePermission(req, 'progress_billing', 'delete');
    const { id } = await params;
    const s = sb();
    const { data: cancelled, error: cancelError } = await s.rpc('cancel_progress_billing_atomic', {
      p_company_id: auth.companyId,
      p_claim_id: id,
      p_user_id: auth.userId,
    });
    if (cancelError) throw cancelError;
    return success(cancelled);
  } catch (err) {
    return handleApiError(err);
  }
}
