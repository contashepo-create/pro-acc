import { NextRequest } from 'next/server';
import { success, error, notFound, parseBody, handleApiError, requireModulePermission } from '@/lib/api-helpers';
import { getSupabase } from '@/lib/supabase-client';
import { postReversalEntry } from '@/lib/voucher-utils';

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
    const { data: existing } = await s.from('progress_billing')
      .select('*').eq('id', id).eq('company_id', auth.companyId).maybeSingle();
    if (!existing) return notFound();
    const claim = existing as any;

    if (body.status === 'cancelled') {
      if (claim.status === 'cancelled') return success(claim);
      if (claim.journal_entry_id) {
        const reversal = await postReversalEntry(auth.companyId, {
          journalEntryId: claim.journal_entry_id,
          referenceType: 'progress_billing_reversal',
          referenceId: id,
          description: `عكس مستخلص ${claim.claim_number || id}`,
          userId: auth.userId,
        });
        if (reversal.error) throw reversal.error;
      }
      const { data: cancelled, error: cancelError } = await s.from('progress_billing')
        .update({ status: 'cancelled', cancelled_at: new Date().toISOString() })
        .eq('id', id).eq('company_id', auth.companyId).select('*').single();
      if (cancelError) throw cancelError;
      return success(cancelled);
    }

    const financialFields = ['date', 'gross_amount', 'retention_rate', 'retention_percentage', 'tax_rate', 'tax_amount', 'net_amount', 'project_id'];
    if (claim.journal_entry_id && financialFields.some((field) => body[field] !== undefined)) {
      return error('لا يمكن تعديل القيم المالية لمستخلص مُرحّل. ألغِه بقيد عكسي وأنشئ مستخلصاً جديداً.', 409);
    }
    if (body.status !== undefined) return error('انتقال حالة المستخلص غير صالح');

    const patch: Record<string, unknown> = {};
    if (typeof body.claim_number === 'string' && body.claim_number.trim()) patch.claim_number = body.claim_number.trim().slice(0, 80);
    if (typeof body.description === 'string') patch.description = body.description.trim().slice(0, 2000);
    if (typeof body.notes === 'string') patch.description = body.notes.trim().slice(0, 2000);
    if (body.is_final !== undefined) patch.is_final = Boolean(body.is_final);
    if (Object.keys(patch).length === 0) return error('لا توجد تغييرات مسموحة');

    const { data: updated, error: updateError } = await s.from('progress_billing')
      .update(patch).eq('id', id).eq('company_id', auth.companyId).select('*').single();
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
    const { data: existing } = await s.from('progress_billing')
      .select('id, status, claim_number, journal_entry_id')
      .eq('id', id).eq('company_id', auth.companyId).maybeSingle();
    if (!existing) return notFound();
    const claim = existing as any;

    if (!claim.journal_entry_id && claim.status === 'draft') {
      const { error: deleteError } = await s.from('progress_billing')
        .delete().eq('id', id).eq('company_id', auth.companyId);
      if (deleteError) throw deleteError;
      return success({ deleted: true });
    }
    if (claim.status === 'cancelled') return success({ cancelled: true });

    const reversal = await postReversalEntry(auth.companyId, {
      journalEntryId: claim.journal_entry_id,
      referenceType: 'progress_billing_reversal',
      referenceId: id,
      description: `إلغاء مستخلص ${claim.claim_number || id}`,
      userId: auth.userId,
    });
    if (reversal.error) throw reversal.error;
    const { error: cancelError } = await s.from('progress_billing')
      .update({ status: 'cancelled', cancelled_at: new Date().toISOString() })
      .eq('id', id).eq('company_id', auth.companyId);
    if (cancelError) throw cancelError;
    return success({ cancelled: true });
  } catch (err) {
    return handleApiError(err);
  }
}
