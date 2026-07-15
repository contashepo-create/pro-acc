import { NextRequest } from 'next/server';
import { success, error, notFound, requireApiAuth, handleApiError } from '@/lib/api-helpers';
import { getSupabase } from '@/lib/supabase-client';

const sb = () => getSupabase();

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const auth = await requireApiAuth(request);
    const { id } = await params;
    const s = sb();

    const { data: bond } = await s.from('bonds')
      .select('*, projects(name), contacts(name), tenders(title)')
      .eq('id', id)
      .eq('company_id', auth.companyId)
      .maybeSingle();

    if (!bond) return notFound();

    const b = bond as any;
    return success({
      ...b,
      project_name: b.projects?.name || null,
      contact_name: b.contacts?.name || null,
      tender_title: b.tenders?.title || null,
      daysUntilExpiry: b.expiry_date
        ? Math.max(0, Math.ceil((new Date(b.expiry_date).getTime() - Date.now()) / 86400000))
        : null,
      daysActive: b.issue_date
        ? Math.floor((Date.now() - new Date(b.issue_date).getTime()) / 86400000)
        : null,
    });
  } catch (err) {
    return handleApiError(err);
  }
}

export async function PUT(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const auth = await requireApiAuth(request);
    const { id } = await params;
    const s = sb();
    const body = await request.json();
    const { action, notes } = body;

    if (action === 'release' || action === 'cancel') {
      const { data, error: updateErr } = await s.from('bonds')
        .update({
          status: action === 'release' ? 'released' : 'cancelled',
          released_at: new Date().toISOString(),
          notes: notes || null,
          updated_at: new Date().toISOString(),
        })
        .eq('id', id)
        .eq('company_id', auth.companyId)
        .select()
        .single();

      if (updateErr) throw updateErr;
      return success(data);
    }

    // Regular update
    const allowedFields = ['title', 'amount', 'expiry_date', 'notes', 'beneficiary_name'];
    const updateData: Record<string, any> = {};
    for (const field of allowedFields) {
      if (body[field] !== undefined) updateData[field] = body[field];
    }
    updateData.updated_at = new Date().toISOString();

    const { data, error: updateErr } = await s.from('bonds')
      .update(updateData)
      .eq('id', id)
      .eq('company_id', auth.companyId)
      .select()
      .single();

    if (updateErr) throw updateErr;
    return success(data);
  } catch (err) {
    return handleApiError(err);
  }
}

export async function DELETE(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const auth = await requireApiAuth(request);
    const { id } = await params;
    const s = sb();

    await s.from('bonds').delete().eq('id', id).eq('company_id', auth.companyId);
    return success({ deleted: true });
  } catch (err) {
    return handleApiError(err);
  }
}
