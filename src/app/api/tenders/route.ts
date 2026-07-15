import { NextRequest } from 'next/server';
import { success, error, requireApiAuth, handleApiError, getPaginationParams } from '@/lib/api-helpers';
import { getSupabase } from '@/lib/supabase-client';
import { generateId } from '@/lib/utils';

const sb = () => getSupabase();

/**
 * GET /api/tenders — List all tenders with status summary
 */
export async function GET(request: NextRequest) {
  try {
    const auth = await requireApiAuth(request);
    const s = sb();
    const url = new URL(request.url);
    const { page, pageSize } = getPaginationParams(url);
    const status = url.searchParams.get('status');

    let query = s.from('tenders')
      .select('*, tenders_contacts(name)', { count: 'exact' })
      .eq('company_id', auth.companyId);

    if (status) query = query.eq('status', status);

    const offset = (page - 1) * pageSize;
    const { data, error: qErr, count } = await query
      .order('submission_deadline', { ascending: true })
      .range(offset, offset + pageSize - 1);

    if (qErr) throw qErr;

    const tenders = (data || []).map((t: any) => ({
      ...t,
      contact_name: t.tenders_contacts?.name || null,
      daysUntilDeadline: t.submission_deadline
        ? Math.max(0, Math.ceil((new Date(t.submission_deadline).getTime() - Date.now()) / 86400000))
        : null,
      isOverdue: t.submission_deadline && new Date(t.submission_deadline) < new Date(),
    }));

    // Summary stats
    const stats = {
      total: count || 0,
      draft: tenders.filter((t: any) => t.status === 'draft').length,
      preparing: tenders.filter((t: any) => t.status === 'preparing').length,
      submitted: tenders.filter((t: any) => t.status === 'submitted').length,
      won: tenders.filter((t: any) => t.status === 'won').length,
      lost: tenders.filter((t: any) => t.status === 'lost').length,
    };

    return success({ tenders, total: count || 0, page, pageSize, stats });
  } catch (err) {
    return handleApiError(err);
  }
}

/**
 * POST /api/tenders — Create a new tender
 */
export async function POST(request: NextRequest) {
  try {
    const auth = await requireApiAuth(request);
    const s = sb();
    const body = await request.json();

    if (!body.title || !body.client_name) {
      return error('عنوان العطاء واسم العميل مطلوبان');
    }

    const tenderId = generateId();
    const { data, error: insertErr } = await s.from('tenders')
      .insert({
        id: tenderId,
        company_id: auth.companyId,
        title: body.title,
        client_name: body.client_name,
        contact_id: body.contact_id || null,
        reference_number: body.reference_number || null,
        description: body.description || null,
        estimated_value: body.estimated_value || null,
        bid_bond_amount: body.bid_bond_amount || null,
        submission_deadline: body.submission_deadline || null,
        opening_date: body.opening_date || null,
        project_location: body.project_location || null,
        project_duration_months: body.project_duration_months || null,
        status: body.status || 'draft', // draft, preparing, submitted, won, lost, cancelled
        win_probability: body.win_probability || null,
        notes: body.notes || null,
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
