import { NextRequest } from 'next/server';
import { success, error, handleApiError, requireModulePermission } from '@/lib/api-helpers';
import { getSupabase } from '@/lib/supabase-client';

const number = (value: unknown) => Number(value) || 0;
const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export async function GET(req: NextRequest) {
  try {
    const auth = await requireModulePermission(req, 'reports', 'read');
    const s = getSupabase();
    const projectId = req.nextUrl.searchParams.get('projectId');
    const type = req.nextUrl.searchParams.get('type') || 'project-costs';
    const from = req.nextUrl.searchParams.get('from');
    const to = req.nextUrl.searchParams.get('to');
    const page = Math.max(1, Number.parseInt(req.nextUrl.searchParams.get('page') || '1', 10) || 1);
    const pageSize = Math.min(500, Math.max(1, Number.parseInt(req.nextUrl.searchParams.get('page_size') || '100', 10) || 100));
    if (!['project-costs', 'material-issuances', 'inventory-transfers'].includes(type)) return error('نوع التقرير غير صالح');
    if (projectId && !uuid.test(projectId)) return error('معرّف المشروع غير صالح');
    if ((from && !/^\d{4}-\d{2}-\d{2}$/.test(from)) || (to && !/^\d{4}-\d{2}-\d{2}$/.test(to)) || (from && to && from > to)) return error('فترة التقرير غير صالحة');
    if (projectId) {
      const { data: project } = await s.from('projects').select('id').eq('id', projectId).eq('company_id', auth.companyId).maybeSingle();
      if (!project) return error('المشروع غير موجود', 404);
    }

    if (type === 'project-costs') {
      const { data, error: queryError } = await s.rpc('get_project_account_totals', {
        p_company_id: auth.companyId, p_project_ids: projectId ? [projectId] : null, p_from: from, p_to: to,
      });
      if (queryError) throw queryError;
      const costs = { materials: 0, workers: 0, purchases: 0, subcontractors: 0, total: 0 };
      for (const row of data || []) {
        if (row.account_type !== 'expense') continue;
        const amount = number(row.debit) - number(row.credit);
        costs.total += amount;
        const code = String(row.code || '');
        if (code.startsWith('511')) costs.materials += amount;
        else if (code.startsWith('521') || code.startsWith('522')) costs.workers += amount;
        else if (code.startsWith('513')) costs.subcontractors += amount;
        else costs.purchases += amount;
      }
      return success({ ...costs, source: 'general_ledger', period: { from, to } });
    }

    let query = s.from('inventory_transactions')
      .select(type === 'material-issuances' ? '*, inventory_items(name, code), projects(name)' : '*, inventory_items(name, code)', { count: 'exact' })
      .eq('company_id', auth.companyId);
    query = type === 'material-issuances' ? query.in('type', ['issue', 'return']) : query.eq('type', 'transfer');
    if (projectId) query = query.eq('project_id', projectId);
    if (from) query = query.gte('date', from);
    if (to) query = query.lte('date', to);
    const { data, error: queryError, count } = await query.order('date', { ascending: false })
      .range((page - 1) * pageSize, page * pageSize - 1);
    if (queryError) throw queryError;
    const rows = (data || []).map((item: any) => ({
      ...item, item_name: item.inventory_items?.name || null,
      item_code: item.inventory_items?.code || null, project_name: item.projects?.name || null,
    }));
    return success({ rows, page, pageSize, total: count || 0, totalPages: Math.ceil((count || 0) / pageSize) });
  } catch (err) {
    return handleApiError(err);
  }
}
