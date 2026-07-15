import { NextRequest } from 'next/server';
import { success, error, requireApiAuth, handleApiError, getPaginationParams } from '@/lib/api-helpers';
import { getSupabase } from '@/lib/supabase-client';
import { generateId } from '@/lib/utils';

const sb = () => getSupabase();

/**
 * GET /api/crm — List leads/opportunities with pipeline stages
 */
export async function GET(request: NextRequest) {
  try {
    const auth = await requireApiAuth(request);
    const s = sb();
    const url = new URL(request.url);
    const { page, pageSize } = getPaginationParams(url);
    const stage = url.searchParams.get('stage');
    const type = url.searchParams.get('type'); // lead, opportunity, customer

    let query = s.from('crm_contacts')
      .select('*, crm_followups(id, type, scheduled_at, notes)', { count: 'exact' })
      .eq('company_id', auth.companyId);

    if (stage) query = query.eq('pipeline_stage', stage);
    if (type) query = query.eq('type', type);

    const offset = (page - 1) * pageSize;
    const { data, error: qErr, count } = await query
      .order('created_at', { ascending: false })
      .range(offset, offset + pageSize - 1);

    if (qErr) throw qErr;

    const contacts = (data || []).map((c: any) => ({
      ...c,
      followups_count: c.crm_followups?.length || 0,
      nextFollowup: (c.crm_followups || [])
        .filter((f: any) => new Date(f.scheduled_at) >= new Date())
        .sort((a: any, b: any) => new Date(a.scheduled_at).getTime() - new Date(b.scheduled_at).getTime())[0] || null,
    }));

    // Pipeline summary
    const pipeline = {
      new: contacts.filter((c: any) => c.pipeline_stage === 'new').length,
      contacted: contacts.filter((c: any) => c.pipeline_stage === 'contacted').length,
      qualified: contacts.filter((c: any) => c.pipeline_stage === 'qualified').length,
      proposal: contacts.filter((c: any) => c.pipeline_stage === 'proposal').length,
      negotiation: contacts.filter((c: any) => c.pipeline_stage === 'negotiation').length,
      won: contacts.filter((c: any) => c.pipeline_stage === 'won').length,
      lost: contacts.filter((c: any) => c.pipeline_stage === 'lost').length,
    };

    const conversionRate = contacts.length > 0
      ? ((pipeline.won / (contacts.length - pipeline.new)) * 100).toFixed(1)
      : '0';

    return success({ contacts, total: count || 0, page, pageSize, pipeline, conversionRate });
  } catch (err) {
    return handleApiError(err);
  }
}

/**
 * POST /api/crm — Create a new lead/contact
 */
export async function POST(request: NextRequest) {
  try {
    const auth = await requireApiAuth(request);
    const s = sb();
    const body = await request.json();

    if (!body.name || !body.type) {
      return error('الاسم والنوع مطلوبان');
    }

    const validTypes = ['lead', 'opportunity', 'customer'];
    if (!validTypes.includes(body.type)) {
      return error(`النوع غير صالح. الخيارات: ${validTypes.join('، ')}`);
    }

    const contactId = generateId();
    const { data, error: insertErr } = await s.from('crm_contacts')
      .insert({
        id: contactId,
        company_id: auth.companyId,
        name: body.name,
        type: body.type,
        email: body.email || null,
        phone: body.phone || null,
        company_name: body.company_name || null,
        source: body.source || 'other', // website, referral, cold_call, tender, social, other
        pipeline_stage: body.pipeline_stage || 'new',
        estimated_value: body.estimated_value || null,
        description: body.description || null,
        assigned_to: body.assigned_to || auth.userId,
        created_by: auth.userId,
        created_at: new Date().toISOString(),
      })
      .select()
      .single();

    if (insertErr) throw insertErr;
    return success(data, 201);
  } catch (err) {
    return handleApiError(err);
  }
}
