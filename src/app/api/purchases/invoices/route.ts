import { NextRequest } from 'next/server';
import { success, error, parseBody, getPaginationParams, requireModulePermission, handleApiError } from '@/lib/api-helpers';
import { getSupabase } from '@/lib/supabase-client';
import { purchaseInvoiceSchema } from '@/lib/validation';

const sb = () => getSupabase();
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const STATUSES = new Set(['unpaid', 'partial', 'paid', 'cancelled']);
const INVOICE_COLUMNS = 'id, invoice_number, number, date, supplier_id, purchase_order_id, project_id, custody_id, payment_source, subtotal, tax_amount, tax_rate, total, paid_amount, status, notes, journal_entry_id, created_by, created_at, updated_at, contacts!supplier_id(name), purchase_orders!purchase_order_id(po_number)';
const ITEM_COLUMNS = 'id, purchase_invoice_id, description, quantity, unit_price, total';

export async function GET(req: NextRequest) {
  try {
    const auth = await requireModulePermission(req, 'purchase_invoices', 'read');
    const url = new URL(req.url);
    const { page, pageSize } = getPaginationParams(url);
    const supplierId = url.searchParams.get('supplierId');
    const status = url.searchParams.get('status');
    if (supplierId && !UUID_RE.test(supplierId)) return error('معرّف المورد غير صالح');
    if (status && !STATUSES.has(status)) return error('حالة فاتورة المشتريات غير صالحة');
    let query = sb().from('purchase_invoices').select(INVOICE_COLUMNS, { count: 'exact' }).eq('company_id', auth.companyId);
    if (supplierId) query = query.eq('supplier_id', supplierId);
    if (status) query = query.eq('status', status);
    const offset = (page - 1) * pageSize;
    const { data, error: queryError, count } = await query.order('date', { ascending: false })
      .order('id', { ascending: false }).range(offset, offset + pageSize - 1);
    if (queryError) throw queryError;
    const invoices: Array<Record<string, unknown> & { items: Record<string, unknown>[] }> = (data || []).map((row: Record<string, unknown>) => ({
      ...row,
      supplier_name: (row.contacts as { name?: string } | null)?.name || null,
      po_number: (row.purchase_orders as { po_number?: string } | null)?.po_number || null,
      contacts: undefined, purchase_orders: undefined, items: [] as Record<string, unknown>[],
      paid_amount: Number(row.paid_amount) || 0,
    }));
    const ids = invoices.map((invoice) => String(invoice.id));
    if (ids.length) {
      const { data: items, error: itemsError } = await sb().from('purchase_invoice_items').select(ITEM_COLUMNS)
        .in('purchase_invoice_id', ids).eq('company_id', auth.companyId).order('id');
      if (itemsError) throw itemsError;
      const grouped = new Map<string, Record<string, unknown>[]>();
      for (const item of items || []) {
        const list = grouped.get(item.purchase_invoice_id) || [];
        list.push(item); grouped.set(item.purchase_invoice_id, list);
      }
      for (const invoice of invoices) invoice.items = grouped.get(String(invoice.id)) || [];
    }
    return success({ invoices, total: count || 0, page, pageSize });
  } catch (err) {
    return handleApiError(err);
  }
}

export async function POST(req: NextRequest) {
  try {
    const auth = await requireModulePermission(req, 'purchase_invoices', 'create');
    const parsed = purchaseInvoiceSchema.safeParse(await parseBody(req));
    if (!parsed.success) return error(parsed.error.issues[0].message);
    const value = parsed.data;
    const { data, error: createError } = await sb().rpc('create_purchase_invoice_atomic', {
      p_company_id: auth.companyId, p_supplier_id: value.supplier_id,
      p_purchase_order_id: value.purchase_order_id || null, p_project_id: value.project_id || null,
      p_custody_id: value.custody_id || null, p_link_to_project: value.link_to_project !== false,
      p_date: value.date, p_items: value.items, p_tax_rate: value.tax_rate,
      p_notes: value.notes || '', p_user_id: auth.userId,
      p_other_expenses: value.other_expenses || [],
      p_payment_account_id: value.payment_account_id || null,
    });
    const message = String(createError?.message || '');
    if (message.includes('المورد غير موجود') || message.includes('المشروع غير موجود')) return error(message, 404);
    if (message.includes('أمر الشراء') || message.includes('العهدة') || message.includes('تسبق')) return error(message, 409);
    if (createError) throw createError;
    const invoice = (data || {}) as Record<string, unknown>;
    const { data: items, error: itemsError } = await sb().from('purchase_invoice_items').select(ITEM_COLUMNS)
      .eq('purchase_invoice_id', invoice.id).eq('company_id', auth.companyId).order('id');
    if (itemsError) throw itemsError;
    return success({ ...invoice, items: items || [] }, 201);
  } catch (err) {
    return handleApiError(err);
  }
}
