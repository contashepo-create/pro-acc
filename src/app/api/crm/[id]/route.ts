import { NextRequest } from 'next/server';
import { success, error, notFound, parseBody, handleApiError, requireModulePermission } from '@/lib/api-helpers';
import { getSupabase } from '@/lib/supabase-client';
import { generateId } from '@/lib/utils';

const sb = () => getSupabase();

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const auth = await requireModulePermission(request, 'crm', 'read');
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
      .eq('company_id', auth.companyId)
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
    const auth = await requireModulePermission(request, 'crm', 'update');
    const { id } = await params;
    const s = sb();
    const body = await parseBody<any>(request);
    const { data: current } = await s.from('crm_contacts').select('id, pipeline_stage')
      .eq('id', id).eq('company_id', auth.companyId).maybeSingle();
    if (!current) return notFound();
    if (body.type && !['lead', 'opportunity', 'customer'].includes(body.type)) return error('النوع غير صالح');
    if (body.source && !['website', 'referral', 'cold_call', 'tender', 'social', 'other'].includes(body.source)) return error('المصدر غير صالح');
    if (body.name !== undefined && (typeof body.name !== 'string' || !body.name.trim() || body.name.length > 200)) return error('الاسم غير صالح');
    if (body.estimated_value !== undefined && (!Number.isFinite(Number(body.estimated_value)) || Number(body.estimated_value) < 0)) return error('القيمة المقدرة غير صالحة');
    if (body.assigned_to) {
      const { data: assignee } = await s.from('users').select('id')
        .eq('id', body.assigned_to).eq('company_id', auth.companyId).eq('is_active', true).maybeSingle();
      if (!assignee) return error('المستخدم المسند إليه غير موجود', 404);
    }
    if (body.pipeline_stage !== undefined && body.pipeline_stage !== (current as any).pipeline_stage) {
      const transitions: Record<string, string[]> = {
        new: ['contacted', 'lost'], contacted: ['qualified', 'lost'], qualified: ['proposal', 'lost'],
        proposal: ['negotiation', 'won', 'lost'], negotiation: ['won', 'lost'], won: [], lost: [],
      };
      if (!(transitions[(current as any).pipeline_stage] || []).includes(body.pipeline_stage)) return error('انتقال مرحلة العميل غير صالح', 409);
    }

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
    const auth = await requireModulePermission(request, 'crm', 'delete');
    const { id } = await params;
    const s = sb();

    // عزل مستأجرين: التحقق من الملكية قبل أي حذف — كان حذف متابعات طرف
    // أجنبي ممكناً بمجرد تخمين المعرّف (حذف بيانات شركة أخرى)
    const { data: existing } = await s.from('crm_contacts')
      .select('id, pipeline_stage')
      .eq('id', id)
      .eq('company_id', auth.companyId)
      .maybeSingle();
    if (!existing) return notFound();
    if ((existing as any).pipeline_stage === 'won') return error('لا يمكن حذف عميل رابح؛ احتفظ بسجل العلاقة', 409);

    await s.from('crm_followups').delete().eq('crm_contact_id', id).eq('company_id', auth.companyId);
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
    const auth = await requireModulePermission(request, 'crm', 'create');
    const { id } = await params;
    const s = sb();
    const body = await parseBody<any>(request);

    if (!body.scheduled_at || !Number.isFinite(Date.parse(body.scheduled_at))) return error('تاريخ المتابعة غير صالح');
    if (body.type && !['call', 'meeting', 'email', 'visit'].includes(body.type)) return error('نوع المتابعة غير صالح');
    if (body.notes !== undefined && (typeof body.notes !== 'string' || body.notes.length > 2000)) return error('الملاحظات طويلة جداً');

    // عزل مستأجرين: الطرف يجب أن ينتمي لهذه الشركة قبل جدولة متابعة له
    const { data: contact } = await s.from('crm_contacts')
      .select('id')
      .eq('id', id)
      .eq('company_id', auth.companyId)
      .maybeSingle();
    if (!contact) return notFound();

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
