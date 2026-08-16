import { NextRequest } from 'next/server';
import { success, error, handleApiError, parseBody, getPaginationParams, requireModulePermission } from '@/lib/api-helpers';
import { getSupabase } from '@/lib/supabase-client';
import { crmCreateSchema, crmStage, crmType } from '@/lib/relationship-validation';

const sb = () => getSupabase();

/** GET /api/crm — tenant-scoped leads and opportunities. */
export async function GET(request: NextRequest) {
  try {
    const auth = await requireModulePermission(request, 'crm', 'read');
    const s = sb();
    const url = new URL(request.url);
    const { page, pageSize } = getPaginationParams(url);
    const stage = url.searchParams.get('stage');
    const type = url.searchParams.get('type');
    if (stage && !crmStage.safeParse(stage).success) return error('مرحلة المسار غير صالحة');
    if (type && !crmType.safeParse(type).success) return error('نوع العميل المحتمل غير صالح');

    let query = s.from('crm_contacts')
      .select('*, crm_followups(id, type, scheduled_at, notes)', { count: 'exact' })
      .eq('company_id', auth.companyId);
    if (stage) query = query.eq('pipeline_stage', stage);
    if (type) query = query.eq('type', type);

    const offset = (page - 1) * pageSize;
    const { data, error: queryError, count } = await query.order('created_at', { ascending: false })
      .range(offset, offset + pageSize - 1);
    if (queryError) throw queryError;

    const contacts = (data || []).map((contact: Record<string, unknown>) => {
      const followups = Array.isArray(contact.crm_followups)
        ? contact.crm_followups as Array<Record<string, unknown>> : [];
      return {
        ...contact,
        followups_count: followups.length,
        nextFollowup: followups
          .filter((followup) => new Date(String(followup.scheduled_at)) >= new Date())
          .sort((a, b) => new Date(String(a.scheduled_at)).getTime() - new Date(String(b.scheduled_at)).getTime())[0] || null,
      };
    });

    // Counts must describe the complete tenant pipeline, not only this page.
    const stages = crmStage.options;
    const stageCounts = await Promise.all(stages.map(async (pipelineStage) => {
      const { count: stageCount, error: countError } = await s.from('crm_contacts').select('id', { count: 'exact', head: true })
        .eq('company_id', auth.companyId).eq('pipeline_stage', pipelineStage);
      if (countError) throw countError;
      return [pipelineStage, stageCount || 0] as const;
    }));
    const pipeline = Object.fromEntries(stageCounts) as Record<(typeof stages)[number], number>;
    const decided = pipeline.won + pipeline.lost;
    const conversionRate = decided > 0 ? ((pipeline.won / decided) * 100).toFixed(1) : '0.0';

    return success({ contacts, total: count || 0, page, pageSize, pipeline, conversionRate });
  } catch (err) {
    return handleApiError(err);
  }
}

/** POST /api/crm — create only through the tenant-bound lifecycle RPC. */
export async function POST(request: NextRequest) {
  try {
    const auth = await requireModulePermission(request, 'crm', 'create');
    const parsed = crmCreateSchema.safeParse(await parseBody(request));
    if (!parsed.success) return error(parsed.error.issues[0].message);
    const { data, error: createError } = await sb().rpc('create_crm_contact_atomic', {
      p_company_id: auth.companyId,
      p_payload: parsed.data,
      p_user_id: auth.userId,
    });
    if (createError) {
      const message = String(createError.message || '');
      if (message.includes('غير صالحة')) return error(message);
      throw createError;
    }
    return success(data, 201);
  } catch (err) {
    return handleApiError(err);
  }
}
