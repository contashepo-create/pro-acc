import { NextRequest } from 'next/server';
import { success, error, notFound, requireModulePermission, requireManagerOrAbove, handleApiError } from '@/lib/api-helpers';
import { getSupabase } from '@/lib/supabase-client';
import { inventoryItemUpdateSchema } from '@/lib/validation';

const sb = () => getSupabase();

/**
 * GET /api/inventory/[id] — صنف واحد مع اسم مستودعه
 */
export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const auth = await requireModulePermission(request, 'inventory', 'read');
    const { id } = await params;
    const s = sb();

    const { data: item } = await s.from('inventory_items')
      .select('*, warehouses(name)')
      .eq('id', id)
      .eq('company_id', auth.companyId)
      .maybeSingle();

    if (!item) return notFound();

    return success({
      ...(item as Record<string, any>),
      warehouse_name: (item as Record<string, any>).warehouses?.name || null,
    });
  } catch (err) {
    return handleApiError(err);
  }
}

/**
 * PUT /api/inventory/[id]
 * بيانات وصفية فقط (اسم/وحدة/فئة/تفعيل/مستودع). الكمية والسعر ممنوعان هنا —
 * الرصيد يتحرك بالحركات المخزنية فقط حتى لا يفترق الدفتر عن الواقع.
 */
export async function PUT(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const auth = await requireModulePermission(request, 'inventory', 'update');
    const { id } = await params;
    const s = sb();
    const body = await request.json();

    // الواجهة ترسل النموذج كاملاً (quantity/unit_price...) — نرفض بوضوح بدل التجاهل الصامت
    if (body.quantity !== undefined || body.unit_price !== undefined) {
      return error('لا يمكن تعديل الكمية أو السعر مباشرة — استخدم الحركات المخزنية (إضافة/صرف/تسوية)');
    }

    const parsed = inventoryItemUpdateSchema.safeParse(body);
    if (!parsed.success) return error(parsed.error.issues[0].message);

    const { data: existing } = await s.from('inventory_items')
      .select('id, quantity, warehouse_id')
      .eq('id', id)
      .eq('company_id', auth.companyId)
      .maybeSingle();
    if (!existing) return notFound();

    // إعادة توزيع المستودع لصنف عليه رصيد تنقل المخزون دون حركة موثقة — ممنوع
    if (parsed.data.warehouse_id && parsed.data.warehouse_id !== (existing as any).warehouse_id) {
      const qty = parseFloat((existing as any).quantity) || 0;
      if (qty !== 0) {
        return error('لا يمكن نقل مستودع صنف عليه رصيد — استخدم حركة التحويل');
      }
      const { data: targetWarehouse } = await s.from('warehouses')
        .select('id').eq('id', parsed.data.warehouse_id).eq('company_id', auth.companyId).maybeSingle();
      if (!targetWarehouse) return error('المستودع غير موجود', 404);
    }

    const updateData: any = { updated_at: new Date().toISOString() };
    if (parsed.data.name !== undefined) updateData.name = parsed.data.name;
    if (parsed.data.unit !== undefined) updateData.unit = parsed.data.unit;
    if (parsed.data.category !== undefined) updateData.category = parsed.data.category;
    if (parsed.data.is_active !== undefined) updateData.is_active = parsed.data.is_active;
    if (parsed.data.warehouse_id !== undefined) updateData.warehouse_id = parsed.data.warehouse_id;

    const { data: updated, error: updateErr } = await s.from('inventory_items')
      .update(updateData)
      .eq('id', id)
      .eq('company_id', auth.companyId)
      .select('*')
      .single();

    if (updateErr) throw updateErr;
    return success(updated);
  } catch (err) {
    return handleApiError(err);
  }
}

/**
 * DELETE /api/inventory/[id]
 * مسودات فقط: صنف عليه رصيد أو حركات سابقة لا يُحذف (يُعطَّل بدلاً من ذلك)
 */
export async function DELETE(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const auth = await requireManagerOrAbove(request);
    const { id } = await params;
    const s = sb();

    const { data: existing } = await s.from('inventory_items')
      .select('id, quantity')
      .eq('id', id)
      .eq('company_id', auth.companyId)
      .maybeSingle();
    if (!existing) return notFound();

    if ((parseFloat((existing as any).quantity) || 0) !== 0) {
      return error('لا يمكن حذف صنف عليه رصيد — أعد الرصيد للصفر بتسوية جرد أولاً');
    }

    const { data: txns } = await s.from('inventory_transactions')
      .select('id').eq('item_id', id).eq('company_id', auth.companyId).limit(1);
    if (txns && txns.length > 0) {
      return error('لا يمكن حذف صنف له حركات سابقة — عطّله بدلاً من حذفه');
    }

    const { error: delErr } = await s.from('inventory_items')
      .delete()
      .eq('id', id)
      .eq('company_id', auth.companyId);
    if (delErr) throw delErr;

    return success({ deleted: true });
  } catch (err) {
    return handleApiError(err);
  }
}
