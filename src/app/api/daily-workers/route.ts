import { NextRequest } from 'next/server';
import { success, error, parseBody, getPaginationParams, getDateRangeParams, requireApiAuth, handleApiError } from '@/lib/api-helpers';
import { getSupabase } from '@/lib/supabase-client';

// @ts-ignore
const sb = () => getSupabase() as any;

export async function GET(req: NextRequest) {
  try {
    const auth = await requireApiAuth(req);
    const s = sb();
    const url = new URL(req.url);
    const { page, pageSize } = getPaginationParams(url);
    const { from, to } = getDateRangeParams(url);
    const projectId = url.searchParams.get('projectId');

    let query = s.from('daily_workers')
      .select('*, projects(name)', { count: 'exact' }).eq('company_id', auth.companyId);
    if (from) query = query.gte('date', from);
    if (to) query = query.lte('date', to);
    if (projectId) query = query.eq('project_id', projectId);

    const offset = (page - 1) * pageSize;
    const { data, error: queryError, count } = await query
      .order('date', { ascending: false }).order('id', { ascending: false }).range(offset, offset + pageSize - 1);
    if (queryError) throw queryError;

    const records = (data || []).map((dw: any) => ({ ...dw, project_name: dw.projects?.name || null }));
    return success({ records, total: count || 0, page, pageSize });
  } catch (err) { return handleApiError(err); }
}

export async function POST(req: NextRequest) {
  try {
    const auth = await requireApiAuth(req);
    const s = sb();
    const data = await parseBody(req);
    const { project_id, date, worker_name, worker_type, daily_rate, hours_worked, notes } = data;
    if (!project_id || !date || !worker_name || !daily_rate)
      return error('project_id, date, worker_name, daily_rate are required');

    const hw = hours_worked || 8;
    const { data: result, error: insertError } = await s.from('daily_workers')
      .insert({ company_id: auth.companyId, project_id, date, worker_name, worker_type: worker_type || 'worker', daily_rate, hours_worked: hw, total_amount: daily_rate * hw / 8, notes, created_by: auth.userId })
      .select('*').single();
    if (insertError) throw insertError;
    return success(result, 201);
  } catch (err) { return handleApiError(err); }
}
