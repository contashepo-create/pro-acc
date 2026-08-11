import { NextRequest } from 'next/server';
import { success, error, parseBody, getPaginationParams, requireModulePermission, handleApiError } from '@/lib/api-helpers';
import { getSupabase } from '@/lib/supabase-client';
import { inventoryItemSchema } from '@/lib/validation';

const sb = () => getSupabase();

export async function GET(req: NextRequest) {
  try {
    const auth = await requireModulePermission(req, 'inventory', 'read');
    const s = sb();
    const url = new URL(req.url);
    const { page, pageSize } = getPaginationParams(url);
    const warehouseId = url.searchParams.get('warehouseId');

    if (url.searchParams.has('warehouses')) {
      const { data, error: wErr } = await s.from('warehouses').select('*').eq('company_id', auth.companyId).order('name');
      if (wErr) throw wErr;
      return success({ warehouses: data || [] });
    }

    if (url.searchParams.has('items')) {
      const { data, error: iErr } = await s.from('inventory_items')
        .select('*, warehouses(name)').eq('company_id', auth.companyId).eq('is_active', true).order('name');
      if (iErr) throw iErr;
      const items = (data || []).map((i: any) => ({ ...i, warehouse_name: i.warehouses?.name || null }));
      return success({ items });
    }

    let query = s.from('inventory_items')
      .select('*, warehouses(name)', { count: 'exact' }).eq('company_id', auth.companyId);
    if (warehouseId) query = query.eq('warehouse_id', warehouseId);

    const offset = (page - 1) * pageSize;
    const { data, error: queryError, count } = await query.order('name').range(offset, offset + pageSize - 1);
    if (queryError) throw queryError;

    const items = (data || []).map((i: any) => ({ ...i, warehouse_name: i.warehouses?.name || null }));
    return success({ items, total: count || 0, page, pageSize });
  } catch (err) { return handleApiError(err); }
}

export async function POST(req: NextRequest) {
  try {
    const auth = await requireModulePermission(req, 'inventory', 'create');
    const s = sb();
    const data = await parseBody(req);

    const parsed = inventoryItemSchema.safeParse(data);
    if (!parsed.success) return error(parsed.error.issues[0].message);
    const { code, name, unit, warehouse_id, category } = parsed.data;

    // TENANT: المستودع المستضيف يجب أن ينتمي لهذه الشركة (كان يقبل مستودعاً أجنبياً)
    const { data: warehouse } = await s.from('warehouses')
      .select('id').eq('id', warehouse_id).eq('company_id', auth.companyId).maybeSingle();
    if (!warehouse) return error('المستودع غير موجود', 404);

    const { data: existing } = await s.from('inventory_items').select('id').eq('company_id', auth.companyId).eq('code', code).maybeSingle();
    if (existing) return error('كود الصنف موجود مسبقاً');

    // الرصيد يبدأ صفراً دائماً — يتحرك بالحركات المخزنية فقط
    const { data: result, error: insertError } = await s.from('inventory_items')
      .insert({ company_id: auth.companyId, code, name, unit, warehouse_id, category: category || null, quantity: 0, unit_price: 0, is_active: true })
      .select('*').single();
    if (insertError) throw insertError;
    return success(result, 201);
  } catch (err) { return handleApiError(err); }
}
