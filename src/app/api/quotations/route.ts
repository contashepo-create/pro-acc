import {NextRequest} from 'next/server';
import {success, error, parseBody, getPaginationParams, requireModulePermission, handleApiError} from '@/lib/api-helpers';
import {getSupabase} from '@/lib/supabase-client';

import type { Row } from '@/lib/types';

const sb = () => getSupabase();

export async function GET(req: NextRequest) {
  try {
    const auth = await requireModulePermission(req, 'quotations', 'read');
    const s = sb();
    const url = new URL(req.url);
    const { page, pageSize } = getPaginationParams(url);
    const status = url.searchParams.get('status');

    let query = s.from('quotations')
      .select('*, contacts(name)', { count: 'exact' })
      .eq('company_id', auth.companyId);
    if (status) query = query.eq('status', status);

    const offset = (page - 1) * pageSize;
    const { data, error: queryError, count } = await query
      .order('date', { ascending: false }).range(offset, offset + pageSize - 1);

    if (queryError) throw queryError;

    const quotations = ((data ?? []) as Row[]).map((q: Row) => ({ ...q, contact_name: q.contacts ? String((q.contacts as Row).name) || null : null } as Row));

    for (const q of quotations) {
      const { data: items, error: itemsErr } = await s.from('quotation_items').select('*')
        .eq('quotation_id', q.id).eq('company_id',auth.companyId).order('id');
      if (itemsErr) throw itemsErr;
      q.items = items || [];
    }

    return success({ quotations, total: count || 0, page, pageSize });
  } catch (err) {
    return handleApiError(err);
  }
}

export async function POST(req: NextRequest) {
  try {
    const auth = await requireModulePermission(req, 'quotations', 'create');
    // Plan limit: monthly quotations cap
    const { checkPlanLimit } = await import('@/lib/plan-limits');
    const limitCheck = await checkPlanLimit(auth.companyId, 'quotations');
    if (!limitCheck.allowed) return error(limitCheck.message || 'تم تجاوز حد عروض الأسعار الشهري', 402);

    const s = sb();
    const data = await parseBody(req);
    const { date, contact_id, items, notes, tax_rate, valid_until } = data;

    if (!date || !contact_id || !Array.isArray(items) || items.length === 0)
      return error('التاريخ والعميل وبنود العرض مطلوبة');

    // عزل مستأجرين: العميل يجب أن ينتمي لهذه الشركة
    const { data: contact } = await s.from('contacts')
      .select('id').eq('id', contact_id).eq('company_id', auth.companyId).maybeSingle();
    if (!contact) return error('العميل غير موجود', 404);

    if (!Array.isArray(items) || items.length>1000 || items.some((item: Row) =>
      typeof item?.description!=='string' || !item.description.trim() || item.description.length>1000
      || !Number.isFinite(Number(item.quantity)) || Number(item.quantity)<=0
      || !Number.isFinite(Number(item.unit_price)) || Number(item.unit_price)<0
      || Math.abs(Number(item.quantity)*100-Math.round(Number(item.quantity)*100))>1e-8
      || Math.abs(Number(item.unit_price)*100-Math.round(Number(item.unit_price)*100))>1e-8)) return error('أحد بنود عرض السعر غير صالح');
    const rate=Number(tax_rate || 0);
    if (!Number.isFinite(rate) || rate<0 || rate>1 || Math.abs(rate*10000-Math.round(rate*10000))>1e-8) return error('نسبة الضريبة غير صالحة');
    if (!/^\d{4}-\d{2}-\d{2}$/.test(String(date)) || (valid_until && (!/^\d{4}-\d{2}-\d{2}$/.test(String(valid_until)) || valid_until<date))) return error('التاريخ غير صالح');
    if (notes!==undefined && (typeof notes!=='string' || notes.length>5000)) return error('الملاحظات غير صالحة');
    const normalizedItems=items.map((item: Row)=>({description:String(item.description),quantity:Number(item.quantity),unit_price:Number(item.unit_price)}));
    const { data: result, error: rpcErr } = await s.rpc('create_quotation', {
      p_company_id:auth.companyId,p_date:date,p_contact_id:contact_id,p_items:normalizedItems,
      p_notes:typeof notes==='string'?notes.trim():'',p_tax_rate:rate,p_valid_until:valid_until||null,p_created_by:auth.userId,
    });
    if (rpcErr) throw rpcErr;
    return success(result,201);
  } catch (err) {
    return handleApiError(err);
  }
}
