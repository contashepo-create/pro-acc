import { NextRequest } from 'next/server';
import { success, error, requireApiAuth, handleApiError } from '@/lib/api-helpers';
import { getSupabase } from '@/lib/supabase-client';
import { generateId } from '@/lib/utils';

const sb = () => getSupabase();

export async function GET(request: NextRequest) {
  try {
    const auth = await requireApiAuth(request);
    const s = sb();
    const url = new URL(request.url);
    const itemId = url.searchParams.get('itemId');
    const warehouseId = url.searchParams.get('warehouseId');

    let query = s.from('inventory_transactions')
      .select('*, inventory_items(name, code), warehouses(name)')
      .eq('company_id', auth.companyId);

    if (itemId) query = query.eq('item_id', itemId);
    if (warehouseId) query = query.eq('warehouse_id', warehouseId);

    const { data: transactions } = await query.order('date', { ascending: false });

    return success({ transactions: transactions || [] });
  } catch (err) {
    return handleApiError(err);
  }
}

export async function POST(request: NextRequest) {
  try {
    const auth = await requireApiAuth(request);
    const s = sb();
    const body = await request.json();

    if (!body.item_id || !body.warehouse_id || !body.type || !body.quantity) {
      return error('الصنف والمستودع والنوع والكمية مطلوبة');
    }

    const { data: transaction, error: insertErr } = await s.from('inventory_transactions')
      .insert({
        id: generateId(),
        company_id: auth.companyId,
        item_id: body.item_id,
        warehouse_id: body.warehouse_id,
        type: body.type,
        quantity: body.quantity,
        unit_price: body.unit_price || 0,
        total_value: body.total_value || (body.quantity * (body.unit_price || 0)),
        date: body.date || new Date().toISOString().split('T')[0],
        notes: body.notes || null,
        created_by: auth.userId,
      })
      .select('*')
      .single();

    if (insertErr) throw insertErr;

    return success(transaction, 201);
  } catch (err) {
    return handleApiError(err);
  }
}
