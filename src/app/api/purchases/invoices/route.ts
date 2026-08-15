import { NextRequest } from 'next/server';
import { success, error, parseBody, getPaginationParams, requireModulePermission, handleApiError } from '@/lib/api-helpers';
import { getSupabase } from '@/lib/supabase-client';
import { purchaseInvoiceSchema } from '@/lib/validation';

const sb = () => getSupabase();

const round2 = (n: number) => Math.round((n + Number.EPSILON) * 100) / 100;

/**
 * GET /api/purchases/invoices
 * قائمة فواتير المشتريات — مع فلتر المورد (كان يُقرأ ويُتجاهل سابقاً) و
 * المبلغ المدفوع الحقيقي المحسوب من سندات الصرف (كان يُرجَع 0 دائماً).
 */
export async function GET(req: NextRequest) {
  try {
    const auth = await requireModulePermission(req, 'purchase_invoices', 'read');
    const s = sb();
    const url = new URL(req.url);
    const { page, pageSize } = getPaginationParams(url);
    const supplierId = url.searchParams.get('supplierId');
    const statusParam = url.searchParams.get('status');

    const offset = (page - 1) * pageSize;

    let query = s.from('purchase_invoices')
      .select('*, contacts!supplier_id(name), purchase_orders!purchase_order_id(po_number)', { count: 'exact' })
      .eq('company_id', auth.companyId)
      .gte('date', '1970-01-01');
    if (supplierId) query = query.eq('supplier_id', supplierId);
    if (statusParam) query = query.eq('status', statusParam);

    const result = await query
      .order('date', { ascending: false })
      .range(offset, offset + pageSize - 1);

    let data = result.data;
    let count = result.count || 0;

    if (result.error) {
      console.warn('[Purchase Invoices GET] Joined query failed, falling back to simple select:', result.error);
      // تراجع مرن (Graceful Fallback) في حال تعطل علاقات قاعدة البيانات
      let fallbackQuery = s.from('purchase_invoices')
        .select('*', { count: 'exact' })
        .eq('company_id', auth.companyId)
        .gte('date', '1970-01-01');
      if (supplierId) fallbackQuery = fallbackQuery.eq('supplier_id', supplierId);
      if (statusParam) fallbackQuery = fallbackQuery.eq('status', statusParam);

      const fallbackResult = await fallbackQuery
        .order('date', { ascending: false })
        .range(offset, offset + pageSize - 1);

      if (fallbackResult.error) throw fallbackResult.error;
      data = fallbackResult.data;
      count = fallbackResult.count || 0;
    }

    const invoices = (data || []).map((pi: any) => ({
      ...pi,
      supplier_name: pi.contacts?.name || null,
      po_number: pi.purchase_orders?.po_number || null,
      items: [] as any[],
      paid_amount: round2(parseFloat(pi.paid_amount) || 0),
    }));

    // Batch-load items + payments for the page (was an N+1 loop per invoice)
    const ids = invoices.map((inv: any) => inv.id).filter(Boolean);
    if (ids.length > 0) {
      const { data: allItems } = await s.from('purchase_invoice_items')
        .select('*')
        .in('purchase_invoice_id', ids)
        .eq('company_id', auth.companyId);
      const itemsByInvoice = new Map<string, any[]>();
      for (const it of allItems || []) {
        const list = itemsByInvoice.get(it.purchase_invoice_id) || [];
        list.push(it);
        itemsByInvoice.set(it.purchase_invoice_id, list);
      }

      const { data: payments } = await s.from('disbursement_invoice_items')
        .select('purchase_invoice_id, amount')
        .in('purchase_invoice_id', ids)
        .eq('company_id', auth.companyId);
      const paidByInvoice = new Map<string, number>();
      for (const p of payments || []) {
        if (!p.purchase_invoice_id) continue;
        paidByInvoice.set(
          p.purchase_invoice_id,
          (paidByInvoice.get(p.purchase_invoice_id) || 0) + (parseFloat(p.amount) || 0)
        );
      }

      for (const inv of invoices) {
        inv.items = itemsByInvoice.get(inv.id) || [];
        inv.paid_amount = round2(Math.max(inv.paid_amount || 0, paidByInvoice.get(inv.id) || 0));
      }
    }

    return success({ invoices, total: count, page, pageSize });
  } catch (err) {
    return handleApiError(err);
  }
}

/**
 * POST /api/purchases/invoices
 * إنشاء فاتورة مشتريات — تحقق Zod + عزل المستأجرين + إعادة حساب المبالغ
 * خادمياً + ترحيل قيد مزدوج متزن عبر insertJournalLines (مع company_id
 * وأكواد/أسماء الحسابات الحقيقية) + تراجع آلي عند الفشل.
 */
export async function POST(req: NextRequest) {
  try {
    const auth = await requireModulePermission(req, 'purchase_invoices', 'create');
    const s = sb();

    const body = await parseBody(req);
    const parsed = purchaseInvoiceSchema.safeParse(body);
    if (!parsed.success) return error(parsed.error.issues[0].message);

    const { date, supplier_id, purchase_order_id, items, tax_rate, notes, project_id, custody_id, link_to_project } = parsed.data;

    // Supplier/PO/project/custody tenant checks, totals, document lines,
    // journal, and custody subledger movement are one database transaction.
    const { data: invoice, error: createError } = await s.rpc('create_purchase_invoice_atomic', {
      p_company_id: auth.companyId,
      p_supplier_id: supplier_id,
      p_purchase_order_id: purchase_order_id || null,
      p_project_id: project_id || null,
      p_custody_id: custody_id || null,
      p_link_to_project: link_to_project !== false,
      p_date: date,
      p_items: items,
      p_tax_rate: tax_rate,
      p_notes: notes || '',
      p_user_id: auth.userId,
    });
    if (createError) throw createError;
    const result = invoice as Record<string, any>;
    const { data: savedItems, error: itemsError } = await s.from('purchase_invoice_items')
      .select('*').eq('purchase_invoice_id', result.id).eq('company_id', auth.companyId);
    if (itemsError) throw itemsError;
    return success({ ...result, items: savedItems || [] }, 201);
  } catch (err) {
    return handleApiError(err);
  }
}
