import { NextRequest } from 'next/server';
import { success, error, notFound, requireApiAuth, handleApiError } from '@/lib/api-helpers';
import { getSupabase } from '@/lib/supabase-client';
import { generateId } from '@/lib/utils';

const sb = () => getSupabase();

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const auth = await requireApiAuth(request);
    const { id } = await params;
    const s = sb();

    const { data: contact } = await s.from('crm_contacts')
      .select('*')
      .eq('id', id)
      .eq('company_id', auth.companyId)
      .maybeSingle();

    if (!contact) return notFound();

    // Get followups history
    const { data: followups } = await s.from('crm_followups')
      .select('*')
      .eq('crm_contact_id', id)
      .order('scheduled_at', { ascending: false });

    return success({
      ...(contact as any),
      followups: followups || [],
      totalFollowups: (followups || []).length,
      upcomingFollowups: (followups || []).filter((f: any) => new Date(f.scheduled_at) >= new Date()).length,
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

    const allowedFields = ['name', 'email', 'phone', 'company_name', 'source',
      'pipeline_stage', 'estimated_value', 'description', 'assigned_to', 'type'];

    const updateData: Record<string, any> = {};
    for (const field of allowedFields) {
      if (body[field] !== undefined) updateData[field] = body[field];
    }

    // Auto-update type based on stage
    if (body.pipeline_stage === 'won') updateData.type = 'customer';

    updateData.updated_at = new Date().toISOString();

    const { data, error: updateErr } = await s.from('crm_contacts')
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

    await s.from('crm_followups').delete().eq('crm_contact_id', id);
    await s.from('crm_contacts').delete().eq('id', id).eq('company_id', auth.companyId);
    return success({ deleted: true });
  } catch (err) {
    return handleApiError(err);
  }
}

/**
 * POST /api/crm/[id]/followups — Schedule a follow-up
 */
export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const auth = await requireApiAuth(request);
    const { id } = await params;
    const s = sb();
    const body = await request.json();

    if (!body.scheduled_at) {
      return error('تاريخ المتابعة مطلوب');
    }

    const followupId = generateId();
    const { data, error: insertErr } = await s.from('crm_followups')
      .insert({
        id: followupId,
        crm_contact_id: id,
        company_id: auth.companyId,
        type: body.type || 'call', // call, meeting, email, visit
        scheduled_at: body.scheduled_at,
        notes: body.notes || null,
        status: 'scheduled', // scheduled, completed, cancelled
        created_by: auth.userId,
      })
      .select()
      .single();

    if (insertErr) throw insertErr;
    return success(data, 201);
  } catch (err) {
    return handleApiError(err);
  }
}
