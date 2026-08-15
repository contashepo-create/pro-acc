import { NextRequest } from 'next/server';
import { success, error, parseBody, getPaginationParams, requireModulePermission, handleApiError } from '@/lib/api-helpers';
import { getSupabase } from '@/lib/supabase-client';

const sb = () => getSupabase();

export async function GET(req: NextRequest) {
  try {
    const auth = await requireModulePermission(req, 'fixed_assets', 'read');
    const s = sb();
    const url = new URL(req.url);
    const { page, pageSize } = getPaginationParams(url);

    const offset = (page - 1) * pageSize;
    const { data, error: queryError, count } = await s.from('fixed_assets')
      .select('*', { count: 'exact' })
      .eq('company_id', auth.companyId)
      .order('purchase_date', { ascending: false })
      .range(offset, offset + pageSize - 1);

    if (queryError) throw queryError;

    const assets = (data || []).map((f: any) => ({ 
      ...f, 
      net_book_value: (f.purchase_cost || 0) - (f.accumulated_depreciation || 0) 
    }));

    return success({ assets, total: count || 0, page, pageSize });
  } catch (err) { 
    return handleApiError(err); 
  }
}

export async function POST(req: NextRequest) {
  try {
    const auth = await requireModulePermission(req, 'fixed_assets', 'create');
    const s = sb();
    const data = await parseBody(req);
    const { name, code, category, purchase_date, purchase_cost, useful_life_years, depreciation_method, location, notes, bank_safe_id } = data;
    const cost = Number(purchase_cost);
    const life = Number(useful_life_years);
    const method = depreciation_method || 'straight_line';
    if (typeof name!=='string' || !name.trim() || name.length>200 || typeof code!=='string' || !/^[A-Za-z0-9_-]{1,20}$/.test(code)
      || typeof category!=='string' || !category.trim() || category.length>100
      || !/^\d{4}-\d{2}-\d{2}$/.test(purchase_date || '') || !Number.isFinite(cost) || cost<=0
      || Math.abs(cost*100-Math.round(cost*100))>1e-8 || !Number.isInteger(life) || life<1 || life>100
      || !['straight_line','declining_balance'].includes(method) || !bank_safe_id) return error('بيانات الأصل أو حساب الدفع غير صالحة');
    if ((location && (typeof location!=='string' || location.length>500)) || (notes && (typeof notes!=='string' || notes.length>2000))) return error('بيانات وصف الأصل طويلة جداً');
    const { data: asset, error: rpcErr } = await s.rpc('create_fixed_asset', {
      p_company_id: auth.companyId,
      p_name: name.trim(),
      p_code: code.toUpperCase(),
      p_category: category.trim(),
      p_purchase_date: purchase_date,
      p_purchase_cost: cost,
      p_useful_life_years: life,
      p_depreciation_method: method,
      p_location: typeof location==='string' ? location.trim() : '',
      p_notes: typeof notes==='string' ? notes.trim() : '',
      p_bank_safe_id: bank_safe_id,
      p_created_by: auth.userId,
    });
    if (rpcErr) throw rpcErr;
    return success(asset,201);
  } catch (err) { return handleApiError(err); }
}
