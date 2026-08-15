import { NextRequest } from 'next/server';
import { success, error, parseBody, requireManagerOrAbove, handleApiError, requireModulePermission } from '@/lib/api-helpers';
import { getSupabase } from '@/lib/supabase-client';

const sb = () => getSupabase();

export async function GET(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const auth = await requireModulePermission(req, 'currencies', 'read');
    const { id } = await params;
    const s = sb();

    const { data, error: queryError } = await s.from('currencies')
      .select('id, code, name, rate, is_base, company_id')
      .eq('id', id)
      .eq('company_id', auth.companyId)
      .maybeSingle();

    if (queryError || !data) return error('Currency not found', 404);
    return success(data);
  } catch (e) {
    return handleApiError(e);
  }
}

export async function PUT(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const auth = await requireModulePermission(req, 'currencies', 'update');
    const { id } = await params;
    const body = await parseBody(req);
    const s = sb();

    const { data: existing } = await s.from('currencies').select('*')
      .eq('id', id).eq('company_id', auth.companyId).maybeSingle();
    if (!existing) return error('Currency not found', 404);
    const code = body.code === undefined ? (existing as any).code : String(body.code).trim().toUpperCase();
    const name = body.name === undefined ? (existing as any).name : String(body.name).trim();
    const rate = body.rate === undefined ? Number((existing as any).rate) : Number(body.rate);
    const isBase = body.isBase === undefined ? Boolean((existing as any).is_base) : body.isBase;
    if (!/^[A-Z]{3,10}$/.test(code) || !name || name.length > 100 || !Number.isFinite(rate) || rate <= 0 || typeof isBase !== 'boolean') return error('بيانات العملة غير صالحة');
    const { error: saveError } = await s.rpc('save_currency', {
      p_company_id: auth.companyId, p_id: id, p_code: code,
      p_name: name, p_rate: rate, p_is_base: isBase,
    });
    if (saveError) return error(saveError.message || 'تعذر تحديث العملة', 409);
    const { data: result, error: readError } = await s.from('currencies').select('*')
      .eq('id', id).eq('company_id', auth.companyId).maybeSingle();
    if (readError || !result) return error('Currency not found', 404);
    return success(result);
  } catch (e) {
    return handleApiError(e);
  }
}

export async function DELETE(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const auth = await requireManagerOrAbove(req);
    const { id } = await params;
    const s = sb();

    const { data: existing } = await s.from('currencies').select('id, is_base')
      .eq('id', id).eq('company_id', auth.companyId).maybeSingle();
    if (!existing) return error('Currency not found', 404);
    if ((existing as any).is_base) return error('لا يمكن حذف العملة الأساسية', 409);
    const { data: result, error: deleteError } = await s.from('currencies')
      .delete().eq('id', id).eq('company_id', auth.companyId)
      .select('id').maybeSingle();

    if (deleteError || !result) return error('Currency not found', 404);
    return success({ deleted: true });
  } catch (e) {
    return handleApiError(e);
  }
}
