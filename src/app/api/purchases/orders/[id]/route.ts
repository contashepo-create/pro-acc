import { NextRequest } from 'next/server';
import { success, error, parseBody, notFound, requireModulePermission, handleApiError } from '@/lib/api-helpers';
import { getSupabase } from '@/lib/supabase-client';
import { purchaseOrderUpdateSchema, purchaseReceiveSchema } from '@/lib/validation';

const sb = () => getSupabase();
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const ORDER_COLUMNS = 'id, number, po_number, date, supplier_id, total, status, notes, created_by, created_at, updated_at, contacts!supplier_id(name)';
const ITEM_COLUMNS = 'id, purchase_order_id, description, quantity, received_quantity, unit_price, total, inventory_item_id';

export async function GET(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const auth = await requireModulePermission(req, 'purchase_orders', 'read');
    const { id } = await params;
    if (!UUID_RE.test(id)) return error('معرّف أمر الشراء غير صالح');
    const { data: order, error: orderError } = await sb().from('purchase_orders').select(ORDER_COLUMNS)
      .eq('id', id).eq('company_id', auth.companyId).maybeSingle();
    if (orderError) throw orderError;
    if (!order) return notFound();
    const { data: items, error: itemsError } = await sb().from('purchase_order_items').select(ITEM_COLUMNS)
      .eq('purchase_order_id', id).eq('company_id', auth.companyId).order('id');
    if (itemsError) throw itemsError;
    const row = order as Record<string, unknown>;
    return success({ ...row, supplier_name: (row.contacts as { name?: string } | null)?.name || null,
      contacts: undefined, items: items || [] });
  } catch (err) {
    return handleApiError(err);
  }
}

export async function PUT(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const auth = await requireModulePermission(req, 'purchase_orders', 'update');
    const { id } = await params;
    if (!UUID_RE.test(id)) return error('معرّف أمر الشراء غير صالح');
    const parsed = purchaseOrderUpdateSchema.safeParse(await parseBody(req));
    if (!parsed.success) return error(parsed.error.issues[0].message);
    if (!Object.keys(parsed.data).length) return error('لا توجد بيانات للتحديث');
    const { data, error: updateError } = await sb().rpc('update_purchase_order_atomic', {
      p_company_id: auth.companyId, p_order_id: id,
      p_supplier_id: parsed.data.supplier_id || null, p_date: parsed.data.date || null,
      p_items: parsed.data.items || null,
      p_notes: parsed.data.notes === undefined ? null : parsed.data.notes,
      p_user_id: auth.userId,
    });
    const message = String(updateError?.message || '');
    if (message.includes('أمر الشراء غير موجود')) return notFound();
    if (message.includes('المورد غير موجود')) return error('المورد غير موجود أو غير نشط', 404);
    if (message.includes('لا يمكن تعديل')) return error(message, 409);
    if (updateError) throw updateError;
    return success(data);
  } catch (err) {
    return handleApiError(err);
  }
}

export async function PATCH(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const auth = await requireModulePermission(req, 'purchase_orders', 'update');
    const { id } = await params;
    if (!UUID_RE.test(id)) return error('معرّف أمر الشراء غير صالح');
    const parsed = purchaseReceiveSchema.safeParse(await parseBody(req));
    if (!parsed.success) return error(parsed.error.issues[0].message);
    const { data, error: receiveError } = await sb().rpc('receive_purchase_order_atomic', {
      p_company_id: auth.companyId, p_order_id: id,
      p_quantities: parsed.data.quantities || null, p_received_date: parsed.data.date || null,
      p_user_id: auth.userId,
    });
    const message = String(receiveError?.message || '');
    if (message.includes('أمر الشراء غير موجود')) return notFound();
    if (message.includes('ملغى') || message.includes('تتجاوز') || message.includes('يسبق')) return error(message, 409);
    if (message.includes('يلزم مستودع') || message.includes('حسابا المخزون')) return error(message, 422);
    if (receiveError) throw receiveError;
    return success(data);
  } catch (err) {
    return handleApiError(err);
  }
}

export async function DELETE(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const auth = await requireModulePermission(req, 'purchase_orders', 'delete');
    const { id } = await params;
    if (!UUID_RE.test(id)) return error('معرّف أمر الشراء غير صالح');
    const { data, error: cancelError } = await sb().rpc('cancel_purchase_order_atomic', {
      p_company_id: auth.companyId, p_order_id: id, p_user_id: auth.userId,
    });
    const message = String(cancelError?.message || '');
    if (message.includes('أمر الشراء غير موجود')) return notFound();
    if (message.includes('لا يمكن إلغاء')) return error(message, 409);
    if (cancelError) throw cancelError;
    return success(data);
  } catch (err) {
    return handleApiError(err);
  }
}
