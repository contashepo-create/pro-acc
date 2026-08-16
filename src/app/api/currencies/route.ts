import { NextRequest } from 'next/server';
import { success, error, parseBody, requireModulePermission, handleApiError } from '@/lib/api-helpers';
import { getSupabase } from '@/lib/supabase-client';

const sb = () => getSupabase();

export async function GET(req: NextRequest) {
  try {
    const auth = await requireModulePermission(req, 'currencies', 'read');
    const s = sb();
    const { data, error: queryError } = await s.from('currencies')
      .select('*').eq('company_id', auth.companyId).order('is_base', { ascending: false }).order('code');
    if (queryError) throw queryError;
    return success(data || []);
  } catch (err) {
    return handleApiError(err);
  }
}

export async function POST(req: NextRequest) {
  try {
    const auth = await requireModulePermission(req, 'currencies', 'create');
    const s = sb();
    const { code, name, rate, isBase } = await parseBody(req);
    const normalizedCode = typeof code === 'string' ? code.trim().toUpperCase() : '';
    const normalizedName = typeof name === 'string' ? name.trim() : '';
    const normalizedRate = rate === undefined ? 1 : Number(rate);
    if (!/^[A-Z]{3,10}$/.test(normalizedCode) || !normalizedName || normalizedName.length > 100) return error('بيانات العملة غير صالحة');
    if (!Number.isFinite(normalizedRate) || normalizedRate <= 0) return error('سعر الصرف غير صالح');
    if (isBase !== undefined && typeof isBase !== 'boolean') return error('قيمة العملة الأساسية غير صالحة');
    const { data: currencyId, error: saveError } = await s.rpc('save_currency', {
      p_company_id: auth.companyId, p_id: null, p_code: normalizedCode,
      p_name: normalizedName, p_rate: normalizedRate, p_is_base: !!isBase,
    });
    if (saveError) throw saveError;
    const { data: result, error: readError } = await s.from('currencies').select('*')
      .eq('id', currencyId).eq('company_id', auth.companyId).maybeSingle();
    if (readError || !result) throw readError || new Error('تعذر قراءة العملة');
    return success(result, 201);
  } catch (err) {
    return handleApiError(err);
  }
}
