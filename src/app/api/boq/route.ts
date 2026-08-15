import { NextRequest } from 'next/server';
import { success, error, parseBody, getPaginationParams, requireApiAuth, requireModulePermission, handleApiError } from '@/lib/api-helpers';
import { getSupabase } from '@/lib/supabase-client';

const sb = () => getSupabase();

export async function GET(req: NextRequest) {
  try {
    const auth = await requireModulePermission(req, 'boq', 'read');
    const s = sb();
    const projectId = req.nextUrl.searchParams.get('projectId');
    const { page, pageSize } = getPaginationParams(req.url);

    let query = s.from('boq_items')
      .select('*, projects(name)', { count: 'exact' })
      .eq('company_id', auth.companyId);
    if (projectId) query = query.eq('project_id', projectId);

    const offset = (page - 1) * pageSize;
    const { data, error: queryError, count } = await query
      .order('item_code').range(offset, offset + pageSize - 1);

    if (queryError) {
      // Table might not exist, return empty result
      console.warn('BOQ items table query error:', queryError);
      return success({ boqItems: [], total: 0, page, pageSize });
    }

    const boqItems = (data || []).map((b: any) => ({ ...b, project_name: b.projects?.name || null }));
    return success({ items: boqItems, boqItems, total: count || 0, page, pageSize });
  } catch (err) {
    return handleApiError(err);
  }
}

export async function POST(req: NextRequest) {
  try {
    const auth = await requireModulePermission(req, 'boq', 'create');
    const s = sb();
    const data = await parseBody(req);
    const { project_id, item_code, code, description, unit, quantity, unit_price } = data;
    const effectiveCode = item_code || code;
    const qty = Number(quantity);
    const price = Number(unit_price);
    if (!project_id || typeof effectiveCode !== 'string' || !effectiveCode.trim() || typeof description !== 'string' || !description.trim() || typeof unit !== 'string' || !unit.trim())
      return error('project_id, item_code, description, unit, quantity, unit_price are required');
    if (!Number.isFinite(qty) || qty <= 0 || !Number.isFinite(price) || price < 0) return error('الكمية أو سعر الوحدة غير صالح');
    const { data: project } = await s.from('projects')
      .select('id, status').eq('id', project_id).eq('company_id', auth.companyId).maybeSingle();
    if (!project) return error('المشروع غير موجود', 404);
    if (['completed', 'cancelled'].includes((project as any).status)) return error('لا يمكن تعديل كميات مشروع مغلق');

    const { data: result, error: insertError } = await s.from('boq_items')
      .insert({ company_id: auth.companyId, project_id, item_code: effectiveCode.trim(), description: description.trim(), unit: unit.trim(), quantity: qty, unit_price: price, total: Math.round(qty * price * 100) / 100 })
      .select('*').single();
    if (insertError) throw insertError;
    return success(result, 201);
  } catch (err) {
    return handleApiError(err);
  }
}
