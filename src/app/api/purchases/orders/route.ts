import { NextRequest } from 'next/server';
import { success, error, parseBody, getPaginationParams, requireApiAuth, requireModulePermission, handleApiError } from '@/lib/api-helpers';
import { getSupabase } from '@/lib/supabase-client';
import { getNextPurchaseOrderNumber } from '@/lib/numbering';

const sb = () => getSupabase();

export async function GET(req: NextRequest) {
  try {
    const auth = await requireApiAuth(req);
    const s = sb();
    const url = new URL(req.url);
    const { page, pageSize } = getPaginationParams(url);
    const status = url.searchParams.get('status');

    let query = s.from('purchase_orders')
      .select('*, contacts(name)', { count: 'exact' }).eq('company_id', auth.companyId);
    if (status) query = query.eq('status', status);

    const offset = (page - 1) * pageSize;
    const { data, error: queryError, count } = await query
      .order('date', { ascending: false }).order('id', { ascending: false }).range(offset, offset + pageSize - 1);
    if (queryError) throw queryError;

    const orders = (data || []).map((po: any) => ({ ...po, supplier_name: po.contacts?.name || null }));
    for (const o of orders) {
      const { data: items } = await s.from('purchase_order_items').select('*').eq('purchase_order_id', o.id).order('id');
      o.items = items || [];
    }
    return success({ orders, total: count || 0, page, pageSize });
  } catch (err) { return handleApiError(err); }
}

export async function POST(req: NextRequest) {
  try {
    const auth = await requireApiAuth(req);
    const s = sb();
    const data = await parseBody(req);
    const { date, supplier_id, items, notes } = data;
    if (!date || !supplier_id || !items || items.length === 0)
      return error('date, supplier_id, items are required');

    // FIXED: Use atomic RPC-based numbering instead of manual MAX+1
    const nextNum = await getNextPurchaseOrderNumber(auth.companyId);

    let total = 0;
    for (const item of items) total += (item.quantity || 0) * (item.unit_price || 0);

    const { data: po, error: poErr } = await s.from('purchase_orders')
      .insert({ company_id: auth.companyId, po_number: nextNum, date, supplier_id, total, status: 'pending', notes, created_by: auth.userId })
      .select('*').single();
    if (poErr) throw poErr;

    for (const item of items) {
      await s.from('purchase_order_items').insert({
        purchase_order_id: po.id, description: item.description, quantity: item.quantity,
        unit_price: item.unit_price, total: item.quantity * item.unit_price,
      });
    }
    return success(po, 201);
  } catch (err) { return handleApiError(err); }
}
