import { NextRequest } from 'next/server';
import { success, error, parseBody, requireManagerOrAbove, handleApiError, requireModulePermission } from '@/lib/api-helpers';
import { getSupabase } from '@/lib/supabase-client';

import type { Row } from '@/lib/types';

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

    if (queryError || !data) return error('العملة غير موجودة', 404);
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
    if (!existing) return error('العملة غير موجودة', 404);
    const code = body.code === undefined ? (existing as Row).code : String(body.code).trim().toUpperCase();
    const name = body.name === undefined ? (existing as Row).name : String(body.name).trim();
    const rate = body.rate === undefined ? Number((existing as Row).rate) : Number(body.rate);
    const isBase = body.isBase === undefined ? Boolean((existing as Row).is_base) : body.isBase;
    if (!/^[A-Z]{3,10}$/.test(String(code)) || !name || String(name).length > 100 || !Number.isFinite(rate) || rate <= 0 || typeof isBase !== 'boolean') return error('بيانات العملة غير صالحة');
    const { error: saveError } = await s.rpc('save_currency', {
      p_company_id: auth.companyId, p_id: id, p_code: code,
      p_name: name, p_rate: rate, p_is_base: isBase,
    });
    if (saveError) return error(saveError.message || 'تعذر تحديث العملة', 409);
    const { data: result, error: readError } = await s.from('currencies').select('*')
      .eq('id', id).eq('company_id', auth.companyId).maybeSingle();
    if (readError || !result) return error('العملة غير موجودة', 404);
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
    if (!existing) return error('العملة غير موجودة', 404);
    if ((existing as Row).is_base) return error('لا يمكن حذف العملة الأساسية', 409);
    const { data: result, error: deleteError } = await s.from('currencies')
      .delete().eq('id', id).eq('company_id', auth.companyId)
      .select('id').maybeSingle();

    if (deleteError || !result) return error('العملة غير موجودة', 404);
    return success({ deleted: true });
  } catch (e) {
    return handleApiError(e);
  }
}
