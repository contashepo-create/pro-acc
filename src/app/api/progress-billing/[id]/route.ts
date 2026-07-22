import { NextRequest } from 'next/server';
import { success, error, notFound, parseBody, requireApiAuth, handleApiError } from '@/lib/api-helpers';
import { getSupabase } from '@/lib/supabase-client';

const sb = () => getSupabase();

export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const auth = await requireApiAuth(req);
    const { id } = await params;
    const s = sb();

    const { data: claim, error: queryErr } = await s.from('progress_billing')
      .select('*, projects(name)')
      .eq('id', id)
      .eq('company_id', auth.companyId)
      .maybeSingle();

    if (queryErr) throw queryErr;
    if (!claim) return notFound();

    const result = claim as Record<string, any>;
    result.project_name = result.projects?.name || null;

    return success(result);
  } catch (err) {
    return handleApiError(err);
  }
}

export async function PUT(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const auth = await requireApiAuth(req);
    const { id } = await params;
    const s = sb();
    const body = await parseBody(req);

    const { data: existing } = await s.from('progress_billing')
      .select('id')
      .eq('id', id)
      .eq('company_id', auth.companyId)
      .maybeSingle();

    if (!existing) return notFound();

    const updateData: any = {};
    if (body.date !== undefined) updateData.date = body.date;
    if (body.claim_number !== undefined) updateData.claim_number = body.claim_number;
    if (body.description !== undefined) updateData.description = body.description;
    if (body.gross_amount !== undefined) updateData.gross_amount = body.gross_amount;
    if (body.retention_rate !== undefined) updateData.retention_rate = body.retention_rate;
    if (body.retention_percentage !== undefined) updateData.retention_rate = body.retention_percentage / 100;
    if (body.status !== undefined) updateData.status = body.status;
    if (body.is_final !== undefined) updateData.is_final = body.is_final;
    if (body.notes !== undefined) updateData.description = body.notes;

    const { data: updated, error: updateErr } = await s.from('progress_billing')
      .update(updateData)
      .eq('id', id)
      .select('*')
      .single();

    if (updateErr) throw updateErr;

    return success(updated);
  } catch (err) {
    return handleApiError(err);
  }
}

export async function DELETE(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const auth = await requireApiAuth(req);
    const { id } = await params;
    const s = sb();

    const { data: existing } = await s.from('progress_billing')
      .select('id, journal_entry_id')
      .eq('id', id)
      .eq('company_id', auth.companyId)
      .maybeSingle();

    if (!existing) return notFound();

    const claim = existing as any;
    if (claim.journal_entry_id) {
      const { deleteJournalEntry } = await import('@/lib/journal-utils');
      await deleteJournalEntry(auth.companyId, claim.journal_entry_id);
    }

    await s.from('progress_billing').delete().eq('id', id);

    return success({ deleted: true });
  } catch (err) {
    return handleApiError(err);
  }
}
