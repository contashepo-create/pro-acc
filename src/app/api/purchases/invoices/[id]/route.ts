import { NextRequest } from 'next/server';
import { success, error, parseBody, notFound, requireModulePermission, requireManagerOrAbove, handleApiError } from '@/lib/api-helpers';
import { getSupabase } from '@/lib/supabase-client';
import { purchaseInvoiceUpdateSchema } from '@/lib/validation';

const sb = () => getSupabase();

/**
 * GET /api/purchases/invoices/[id]
 * TENANT: الفاتورة تُجلب مقيدة بالشركة — المعرف وحده لم يعد كافياً للقراءة.
 */
export async function GET(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const auth = await requireModulePermission(req, 'purchase_invoices', 'read');
    const { id } = await params;
    const s = sb();

    const { data: pi, error: piError } = await s.from('purchase_invoices')
      .select('*, contacts!supplier_id(name), purchase_orders!purchase_order_id(po_number)')
      .eq('id', id)
      .eq('company_id', auth.companyId)
      .maybeSingle();

    if (piError || !pi) return notFound();

    // السجلات الفرعية تابعة لأبٍ تحققنا من ملكيته — آمنة دون فلتر شركة إضافي
    const { data: items } = await s.from('purchase_invoice_items')
      .select('*')
      .eq('purchase_invoice_id', id)
      .eq('company_id', auth.companyId)
      .order('id');

    const { data: paid } = await s.from('disbursement_invoice_items')
      .select('amount')
      .eq('purchase_invoice_id', id)
      .eq('company_id', auth.companyId);

    const paidAmount = (paid || []).reduce(
      (sum: number, p: any) => sum + (parseFloat(p.amount) || 0), 0
    );

    return success({
      ...pi,
      supplier_name: (pi as Record<string, any>).contacts?.name || null,
      po_number: (pi as Record<string, any>).purchase_orders?.po_number || null,
      items: items || [],
      paid_amount: paidAmount,
    });
  } catch (err) {
    return handleApiError(err);
  }
}

/**
 * PUT /api/purchases/invoices/[id]
 * إلغاء الفاتورة = قيد عكسي يُبقي القيد الأصلي للتدقيق (بدل حذفه كما كان سابقاً).
 * تحديث الحالة/الملاحظات فقط — المبالغ والبنود لا تُعدَّل بعد الترحيل.
 */
export async function PUT(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const auth = await requireModulePermission(req, 'purchase_invoices', 'update');
    const { id } = await params;
    const s = sb();

    const body = await parseBody(req);
    const parsed = purchaseInvoiceUpdateSchema.safeParse(body);
    if (!parsed.success) return error(parsed.error.issues[0].message);

    if (parsed.data.status && parsed.data.status !== 'cancelled') {
      return error('لا يمكن تغيير حالة الدفع يدوياً؛ الحالة تُشتق من سندات الصرف', 409);
    }
    if (parsed.data.status === 'cancelled') {
      const { data: cancelled, error: cancelError } = await s.rpc('cancel_purchase_invoice_atomic', {
        p_company_id: auth.companyId,
        p_invoice_id: id,
        p_notes: parsed.data.notes || '',
        p_user_id: auth.userId,
      });
      if (cancelError) throw cancelError;
      return success(cancelled);
    }
    if (parsed.data.notes === undefined) return error('لا توجد حقول قابلة للتعديل');
    const { data: result, error: updateError } = await s.rpc('update_purchase_invoice_metadata', {
      p_company_id: auth.companyId,
      p_invoice_id: id,
      p_notes: parsed.data.notes,
      p_user_id: auth.userId,
    });
    if (updateError) throw updateError;
    return success(result);
  } catch (err) {
    return handleApiError(err);
  }
}

/**
 * DELETE /api/purchases/invoices/[id]
 * حذف صلب للمسودات فقط. فاتورة مُرحَّلة (لها قيد) أو عليها مدفوعات أو مرتبطة
 * بأمر شراء (حدّثت المخزون) لا تُحذف أبداً — تُلغى بقيد عكسي عبر PUT.
 * سابقاً كان الحذف يدمر سندات الصرف والقيد الأصلي ويترك المخزون منتفخاً.
 */
export async function DELETE(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const auth = await requireManagerOrAbove(req);
    const { id } = await params;
    const s = sb();

    // Financial purchase invoices are never hard-deleted. DELETE is kept as
    // a compatibility alias for the same audited reversal lifecycle.
    const { data: cancelled, error: cancelError } = await s.rpc('cancel_purchase_invoice_atomic', {
      p_company_id: auth.companyId,
      p_invoice_id: id,
      p_notes: '',
      p_user_id: auth.userId,
    });
    if (cancelError) throw cancelError;
    return success(cancelled);
  } catch (err) {
    return handleApiError(err);
  }
}
