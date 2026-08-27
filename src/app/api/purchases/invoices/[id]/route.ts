import { NextRequest } from 'next/server';
import { success, error, parseBody, notFound, requireModulePermission, handleApiError } from '@/lib/api-helpers';
import { getSupabase } from '@/lib/supabase-client';
import { purchaseInvoiceUpdateSchema } from '@/lib/validation';

const sb = () => getSupabase();
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const INVOICE_COLUMNS = 'id, invoice_number, number, date, supplier_id, purchase_order_id, project_id, custody_id, payment_source, subtotal, tax_amount, tax_rate, total, paid_amount, status, notes, journal_entry_id, created_by, created_at, updated_at, other_expenses_total, withholding_rate, withholding_amount, contacts!supplier_id(name), purchase_orders!purchase_order_id(po_number)';
const ITEM_COLUMNS = 'id, purchase_invoice_id, description, quantity, unit_price, total';

export async function GET(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const auth = await requireModulePermission(req, 'purchase_invoices', 'read');
    const { id } = await params;
    if (!UUID_RE.test(id)) return error('معرّف فاتورة المشتريات غير صالح');
    const { data, error: queryError } = await sb().from('purchase_invoices').select(INVOICE_COLUMNS)
      .eq('id', id).eq('company_id', auth.companyId).maybeSingle();
    if (queryError) throw queryError;
    if (!data) return notFound();
    const { data: items, error: itemsError } = await sb().from('purchase_invoice_items').select(ITEM_COLUMNS)
      .eq('purchase_invoice_id', id).eq('company_id', auth.companyId).order('id');
    if (itemsError) throw itemsError;
    const row = data as Record<string, unknown>;
    return success({ ...row,
      supplier_name: (row.contacts as { name?: string } | null)?.name || null,
      po_number: (row.purchase_orders as { po_number?: string } | null)?.po_number || null,
      contacts: undefined, purchase_orders: undefined, items: items || [], paid_amount: Number(row.paid_amount) || 0,
    });
  } catch (err) {
    return handleApiError(err);
  }
}

export async function PUT(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const auth = await requireModulePermission(req, 'purchase_invoices', 'update');
    const { id } = await params;
    if (!UUID_RE.test(id)) return error('معرّف فاتورة المشتريات غير صالح');
    const parsed = purchaseInvoiceUpdateSchema.safeParse(await parseBody(req));
    if (!parsed.success) return error(parsed.error.issues[0].message);
    if (parsed.data.status && parsed.data.status !== 'cancelled') {
      return error('لا يمكن تغيير حالة الدفع يدوياً؛ الحالة تُشتق من سندات الصرف', 409);
    }
    if (parsed.data.status === 'cancelled') {
      const { data, error: cancelError } = await sb().rpc('cancel_purchase_invoice_atomic', {
        p_company_id: auth.companyId, p_invoice_id: id,
        p_notes: parsed.data.notes || '', p_user_id: auth.userId,
      });
      const message = String(cancelError?.message || '');
      if (message.includes('الفاتورة غير موجودة')) return notFound();
      if (message.includes('لا يمكن')) return error(message, 409);
      if (cancelError) throw cancelError;
      return success(data);
    }
    if (parsed.data.notes === undefined) return error('لا توجد حقول قابلة للتعديل');
    const { data, error: updateError } = await sb().rpc('update_purchase_invoice_metadata', {
      p_company_id: auth.companyId, p_invoice_id: id,
      p_notes: parsed.data.notes, p_user_id: auth.userId,
    });
    if (updateError && String(updateError.message || '').includes('الفاتورة غير موجودة')) return notFound();
    if (updateError) throw updateError;
    return success(data);
  } catch (err) {
    return handleApiError(err);
  }
}

export async function DELETE(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const auth = await requireModulePermission(req, 'purchase_invoices', 'delete');
    const { id } = await params;
    if (!UUID_RE.test(id)) return error('معرّف فاتورة المشتريات غير صالح');
    const { data, error: cancelError } = await sb().rpc('cancel_purchase_invoice_atomic', {
      p_company_id: auth.companyId, p_invoice_id: id, p_notes: '', p_user_id: auth.userId,
    });
    const message = String(cancelError?.message || '');
    if (message.includes('الفاتورة غير موجودة')) return notFound();
    if (message.includes('لا يمكن')) return error(message, 409);
    if (cancelError) throw cancelError;
    return success(data);
  } catch (err) {
    return handleApiError(err);
  }
}
