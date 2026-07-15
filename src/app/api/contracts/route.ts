import { NextRequest } from 'next/server';
import { success, error, requireApiAuth, handleApiError, parseBody, getPaginationParams } from '@/lib/api-helpers';
import { getSupabase } from '@/lib/supabase-client';
import { generateId } from '@/lib/utils';

const sb = () => getSupabase();

/**
 * GET /api/contracts — List contracts with documents
 */
export async function GET(request: NextRequest) {
  try {
    const auth = await requireApiAuth(request);
    const s = sb();
    const url = new URL(request.url);
    const { page, pageSize } = getPaginationParams(url);
    const projectId = url.searchParams.get('project_id');
    const status = url.searchParams.get('status');

    let query = s.from('contracts')
      .select('*, projects(name), contacts(name)', { count: 'exact' })
      .eq('company_id', auth.companyId);

    if (projectId) query = query.eq('project_id', projectId);
    if (status) query = query.eq('status', status);

    const offset = (page - 1) * pageSize;
    const { data, error: qErr, count } = await query
      .order('start_date', { ascending: false })
      .range(offset, offset + pageSize - 1);

    if (qErr) throw qErr;

    const contracts = (data || []).map((c: Record<string, unknown>) => ({
      ...c,
      project_name: (c.projects as { name?: string } | null)?.name || null,
      contact_name: (c.contacts as { name?: string } | null)?.name || null,
      // Check if expiring soon
      isExpiringSoon: c.end_date && new Date(String(c.end_date)).getTime() - Date.now() < 30 * 86400000,
      isExpired: c.end_date && new Date(String(c.end_date)).getTime() < Date.now(),
    }));

    return success({
      contracts,
      total: count || 0,
      page,
      pageSize,
      totalPages: Math.ceil((count || 0) / pageSize),
    });
  } catch (err) {
    return handleApiError(err);
  }
}

/**
 * POST /api/contracts — Create a new contract
 */
export async function POST(request: NextRequest) {
  try {
    const auth = await requireApiAuth(request);
    const s = sb();
    const body = await parseBody<{
      title: string;
      type: string;
      project_id?: string;
      contact_id?: string;
      start_date: string;
      end_date: string;
      value: number;
      description?: string;
      status?: string;
    }>(request);

    if (!body.title || !body.start_date || !body.end_date) {
      return error('العنوان وتاريخ البدء والانتهاء مطلوبة');
    }

    const contractId = generateId();
    const { data: contract, error: insertErr } = await s.from('contracts')
      .insert({
        id: contractId,
        company_id: auth.companyId,
        title: body.title,
        type: body.type || 'general',
        project_id: body.project_id || null,
        contact_id: body.contact_id || null,
        start_date: body.start_date,
        end_date: body.end_date,
        value: body.value || 0,
        description: body.description || null,
        status: body.status || 'active',
        created_by: auth.userId,
      })
      .select('*')
      .single();

    if (insertErr) throw insertErr;

    // Audit log
    try {
      await s.from('audit_log').insert({
        company_id: auth.companyId,
        user_id: auth.userId,
        action: 'create_contract',
        entity_type: 'contract',
        entity_id: contractId,
        new_values: { title: body.title, value: body.value },
      });
    } catch { /* ignore */ }

    return success(contract, 201);
  } catch (err) {
    return handleApiError(err);
  }
}
