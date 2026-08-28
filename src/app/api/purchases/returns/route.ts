import { NextRequest } from 'next/server';
import { success, error, handleApiError, parseBody, getPaginationParams, requireModulePermission } from '@/lib/api-helpers';
import { getSupabase } from '@/lib/supabase-client';
import { isValidDate } from '@/lib/utils';

import type { Row } from '@/lib/types';

const sb = () => getSupabase();
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

/** GET /api/purchases/returns */
export async function GET(request: NextRequest) {
  try {
    const auth = await requireModulePermission(request, 'purchase_invoices', 'read');
    const s = sb();
    const url = new URL(request.url);
    const { page, pageSize } = getPaginationParams(url);
    const invoiceId = url.searchParams.get('invoiceId');
    if (invoiceId && !UUID_RE.test(invoiceId)) return error('معرّف الفاتورة غير صالح');

    let query = s.from('purchase_returns')
      .select('*', { count: 'exact' })
      .eq('company_id', auth.companyId)
      .is('deleted_at', null);
    if (invoiceId) query = query.eq('purchase_invoice_id', invoiceId);

    const offset = (page - 1) * pageSize;
    const { data, error: queryError, count } = await query
      .order('date', { ascending: false })
      .range(offset, offset + pageSize - 1);
    if (queryError) throw queryError;

    const rows = (data || []) as Array<Record<string, unknown>>;
    const invoiceIds = [...new Set(rows.map((row) => row.purchase_invoice_id).filter(Boolean))];
    const invoicesResult = invoiceIds.length
      ? await s.from('purchase_invoices').select('id, number, invoice_number, supplier_id').eq('company_id', auth.companyId).in('id', invoiceIds)
      : { data: [], error: null };
    if (invoicesResult.error) throw invoicesResult.error;
    const invoices = (invoicesResult.data || []) as Row[];
    const supplierIds = [...new Set(invoices.map((row) => row.supplier_id).filter(Boolean))];
    const suppliersResult = supplierIds.length
      ? await s.from('contacts').select('id, name').eq('company_id', auth.companyId).in('id', supplierIds)
      : { data: [], error: null };
    if (suppliersResult.error) throw suppliersResult.error;
    const invoiceMap = Object.fromEntries(invoices.map((row) => [String(row.id), row]));
    const supplierNames = Object.fromEntries(((suppliersResult.data || []) as Row[]).map((row) => [String(row.id), row.name]));

    const returns = rows.map((note) => {
      const invoice = invoiceMap[String(note.purchase_invoice_id)];
      return {
        ...note,
        invoice_number: invoice?.number || invoice?.invoice_number || null,
        supplier_name: invoice ? supplierNames[String(invoice.supplier_id)] || null : null,
      };
    });
    return success({ returns, total: count || 0, page, pageSize });
  } catch (err) {
    return handleApiError(err);
  }
}

/** POST /api/purchases/returns */
export async function POST(request: NextRequest) {
  try {
    const auth = await requireModulePermission(request, 'purchase_invoices', 'create');
    const s = sb();
    const body = await parseBody(request);
    const { purchase_invoice_id, reason, items, date } = body;
    const refundAmount = Number(body.refund_amount ?? body.refundAmount ?? 0);
    const bankSafeId = body.bank_safe_id || body.bankSafeId || null;

    if (typeof reason !== 'string' || !reason.trim() || reason.length > 1000) return error('السبب مطلوب');
    if (typeof purchase_invoice_id !== 'string' || !UUID_RE.test(purchase_invoice_id)) {
      return error('معرّف فاتورة المشتريات غير صالح');
    }
    let sourceItems = Array.isArray(items) ? items : [];
    if (sourceItems.length === 0) {
      const { data: invoiceItems, error: itemsError } = await s
        .from('purchase_invoice_items')
        .select('description, quantity, unit_price')
        .eq('company_id', auth.companyId)
        .eq('purchase_invoice_id', purchase_invoice_id);
      if (itemsError) throw itemsError;
      sourceItems = invoiceItems || [];
    }
    if (!Array.isArray(sourceItems) || sourceItems.length === 0 || sourceItems.length > 200) {
      return error('يجب إضافة بند واحد على الأقل');
    }
    const normalizedItems = sourceItems.map((item: Row) => ({
      description: typeof item.description === 'string' ? item.description.trim() : '',
      quantity: Number(item.quantity), unit_price: Number(item.unit_price),
    }));
    if (normalizedItems.some((item) => !item.description || item.description.length > 500 || !Number.isFinite(item.quantity) || item.quantity <= 0 || !Number.isFinite(item.unit_price) || item.unit_price < 0)) {
      return error('أحد بنود المرتجع غير صالح');
    }

    const effectiveDate = date || new Date().toISOString().split('T')[0];
    if (typeof effectiveDate !== 'string' || !isValidDate(effectiveDate)) {
      return error('تاريخ المرتجع غير صالح');
    }
    if (!Number.isFinite(refundAmount) || refundAmount < 0
      || Math.abs(refundAmount * 100 - Math.round(refundAmount * 100)) > 1e-8) {
      return error('مبلغ الرد النقدي غير صالح');
    }
    if (refundAmount > 0 && (typeof bankSafeId !== 'string' || !UUID_RE.test(bankSafeId))) {
      return error('حدد الخزينة أو البنك لقبض الرد من المورد');
    }

    const { data: purchaseReturn, error: createError } = await s.rpc('create_purchase_return_atomic', {
      p_company_id: auth.companyId,
      p_purchase_invoice_id: purchase_invoice_id,
      p_date: effectiveDate,
      p_reason: reason.trim(),
      p_items: normalizedItems,
      p_user_id: auth.userId,
      p_refund_amount: refundAmount,
      p_bank_safe_id: refundAmount > 0 ? bankSafeId : null,
    });
    if (createError) throw createError;
    return success(purchaseReturn, 201);
  } catch (err) {
    return handleApiError(err);
  }
}
