import { NextRequest } from 'next/server';
import { success, error, parseBody, notFound, requireModulePermission, requireManagerOrAbove, handleApiError } from '@/lib/api-helpers';
import { getSupabase } from '@/lib/supabase-client';
import { purchaseOrderUpdateSchema, purchaseReceiveSchema } from '@/lib/validation';

const sb = () => getSupabase();


/**
 * GET /api/purchases/orders/[id]
 * TENANT: مقيد بالشركة — المعرف وحده لم يعد كافياً للقراءة.
 */
export async function GET(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const auth = await requireModulePermission(req, 'purchase_orders', 'read');
    const { id } = await params;
    const s = sb();

    const { data: po, error: poError } = await s.from('purchase_orders')
      .select('*, contacts!supplier_id(name)')
      .eq('id', id)
      .eq('company_id', auth.companyId)
      .maybeSingle();

    if (poError || !po) return notFound();

    // السجلات الفرعية تابعة لأبٍ تحققنا من ملكيته
    const { data: items, error: itemsError } = await s.from('purchase_order_items')
      .select('*')
      .eq('purchase_order_id', id)
      .eq('company_id', auth.companyId)
      .order('id');
    if (itemsError) throw itemsError;

    return success({
      ...po,
      supplier_name: (po as Record<string, any>).contacts?.name || null,
      items: items || [],
    });
  } catch (err) {
    return handleApiError(err);
  }
}

/**
 * PUT /api/purchases/orders/[id]
 * تعديل أمر معلّق فقط — مقيد بالشركة مع إعادة حساب الإجمالي خادمياً.
 */
export async function PUT(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const auth = await requireModulePermission(req, 'purchase_orders', 'update');
    const { id } = await params;
    const s = sb();

    const body = await parseBody(req);
    const parsed = purchaseOrderUpdateSchema.safeParse(body);
    if (!parsed.success) return error(parsed.error.issues[0].message);

    const { data: result, error: updateError } = await s.rpc('update_purchase_order_atomic', {
      p_company_id: auth.companyId,
      p_order_id: id,
      p_supplier_id: parsed.data.supplier_id || null,
      p_date: parsed.data.date || null,
      p_items: parsed.data.items || null,
      p_notes: parsed.data.notes === undefined ? null : parsed.data.notes,
      p_user_id: auth.userId,
    });
    if (updateError) throw updateError;
    return success(result);
  } catch (err) {
    return handleApiError(err);
  }
}

/**
 * PATCH /api/purchases/orders/[id] — استلام بضاعة
 * FIXES:
 * - صلاحية وحدة purchase_orders (كان أي مستخدم موثّق يستلم ويحدّث المخزون!)
 * - عزل الشركة على الأمر (كان قبولاً متقاطعاً بين المستأجرين)
 * - كمية الاستلام تُحصر بالمتبقي قبل استخدامها في المخزون (كان التضخيم ممكناً)
 * - الكميات السالبة مرفوضة بالمخطط (كانت تخصم من المخزون — ثغرة سرقة)
 */
export async function PATCH(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const auth = await requireModulePermission(req, 'purchase_orders', 'update');
    const { id } = await params;
    const s = sb();

    const body = await parseBody(req);
    const parsed = purchaseReceiveSchema.safeParse(body);
    if (!parsed.success) return error(parsed.error.issues[0].message);
    const data = parsed.data;

    const { data: updated, error: receiveError } = await s.rpc('receive_purchase_order_atomic', {
      p_company_id: auth.companyId,
      p_order_id: id,
      p_quantities: data.quantities || null,
      p_received_date: data.date || null,
      p_user_id: auth.userId,
    });
    if (receiveError) throw receiveError;
    return success(updated);
  } catch (err) {
    return handleApiError(err);
  }
}

/**
 * DELETE /api/purchases/orders/[id] — إلغاء ناعم (لا حذف صلب)
 * مقيد بالشركة ومدير فما فوق؛ ممنوع عند وجود استلام جزئي.
 */
export async function DELETE(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const auth = await requireManagerOrAbove(req);
    const { id } = await params;
    const s = sb();

    const { data: cancelled, error: cancelError } = await s.rpc('cancel_purchase_order_atomic', {
      p_company_id: auth.companyId,
      p_order_id: id,
      p_user_id: auth.userId,
    });
    if (cancelError) throw cancelError;
    return success(cancelled);
  } catch (err) {
    return handleApiError(err);
  }
}
