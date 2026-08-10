import { NextRequest } from 'next/server';
import { success, error, parseBody, getPaginationParams, requireModulePermission, handleApiError } from '@/lib/api-helpers';
import { getSupabase } from '@/lib/supabase-client';
import { getNextJournalNumber, getNextPurchaseInvoiceNumber } from '@/lib/numbering';
import { insertJournalLines } from '@/lib/journal-utils';
import { purchaseInvoiceSchema } from '@/lib/validation';
import { ACCOUNT_CODES } from '@/lib/constants';

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
      paid_amount: 0,
    }));

    // Batch-load items + payments for the page (was an N+1 loop per invoice)
    const ids = invoices.map((inv: any) => inv.id).filter(Boolean);
    if (ids.length > 0) {
      const { data: allItems } = await s.from('purchase_invoice_items')
        .select('*')
        .in('purchase_invoice_id', ids);
      const itemsByInvoice = new Map<string, any[]>();
      for (const it of allItems || []) {
        const list = itemsByInvoice.get(it.purchase_invoice_id) || [];
        list.push(it);
        itemsByInvoice.set(it.purchase_invoice_id, list);
      }

      const { data: payments } = await s.from('disbursement_invoice_items')
        .select('purchase_invoice_id, amount')
        .in('purchase_invoice_id', ids);
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
        inv.paid_amount = round2(paidByInvoice.get(inv.id) || 0);
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

    const { date, supplier_id, purchase_order_id, items, tax_rate, notes } = parsed.data;

    // TENANT CHECKS: المورد وأمر الشراء (إن وُجد) يجب أن ينتميا لهذه الشركة —
    // قبل أي عملية كتابة حتى لا يُستهلك الترقيم أو تُنشأ سجلات يتيمة
    const { data: supplier } = await s.from('contacts')
      .select('id').eq('id', supplier_id).eq('company_id', auth.companyId).maybeSingle();
    if (!supplier) return error('المورد غير موجود', 404);

    if (purchase_order_id) {
      const { data: po } = await s.from('purchase_orders')
        .select('id').eq('id', purchase_order_id).eq('company_id', auth.companyId).maybeSingle();
      if (!po) return error('أمر الشراء غير موجود', 404);
    }

    // ACCOUNTING INTEGRITY: كل المبالغ تُحسب خادمياً — قيم العميل تُتجاهل
    const computedItems = items.map((it) => ({
      ...it,
      total: round2(it.quantity * it.unit_price),
    }));
    const subtotal = round2(computedItems.reduce((sum, it) => sum + it.total, 0));
    const taxAmount = round2(subtotal * tax_rate);
    const total = round2(subtotal + taxAmount);

    const nextNum = await getNextPurchaseInvoiceNumber(auth.companyId);

    let invoiceId: string | null = null;
    let journalEntryId: string | null = null;

    try {
      const { data: pi, error: piErr } = await s.from('purchase_invoices')
        .insert({
          company_id: auth.companyId,
          invoice_number: nextNum,
          date,
          supplier_id,
          purchase_order_id: purchase_order_id || null,
          subtotal,
          tax_amount: taxAmount,
          tax_rate,
          total,
          paid_amount: 0,
          status: 'unpaid',
          notes: notes || null,
          created_by: auth.userId,
        })
        .select('*').single();
      if (piErr) throw piErr;
      invoiceId = pi.id;

      for (const item of computedItems) {
        const { error: itemErr } = await s.from('purchase_invoice_items').insert({
          purchase_invoice_id: invoiceId,
          description: item.description,
          quantity: item.quantity,
          unit_price: item.unit_price,
          total: item.total,
        });
        if (itemErr) throw itemErr;
      }

      // تحديث المخزون بالمتوسط المرجح عند الارتباط بأمر شراء
      // (السلوك الحالي مبني على مطابقة code = description — قيد موثق،
      // التوحيد الكامل ضمن مراجعة قسم المخزون)
      if (purchase_order_id) {
        for (const item of computedItems) {
          const { data: invItem } = await s.from('inventory_items')
            .select('id, quantity, unit_price')
            .eq('company_id', auth.companyId)
            .eq('code', item.description)
            .maybeSingle();
          if (invItem) {
            const curQty = parseFloat(invItem.quantity) || 0;
            const curPrice = parseFloat(invItem.unit_price) || 0;
            const newQty = curQty + item.quantity;
            const newPrice = curQty === 0
              ? item.unit_price
              : ((curQty * curPrice) + (item.quantity * item.unit_price)) / newQty;
            await s.from('inventory_items')
              .update({ quantity: newQty, unit_price: newPrice })
              .eq('id', invItem.id)
              .eq('company_id', auth.companyId);
          }
        }
      }

      // الترحيل المحاسبي — فشل صريح عند غياب الحسابات بدل التجاهل الصامت
      const { data: invAcc } = await s.from('accounts').select('id')
        .eq('company_id', auth.companyId).eq('code', ACCOUNT_CODES.INVENTORY).maybeSingle();
      const { data: apAcc } = await s.from('accounts').select('id')
        .eq('company_id', auth.companyId).eq('code', ACCOUNT_CODES.ACCOUNTS_PAYABLE).maybeSingle();
      if (!invAcc || !apAcc) {
        throw new Error('الحسابات الأساسية للمشتريات مفقودة (المخزون 1170 / ذمم الموردين 2110) — فعّل دليل الحسابات أولاً');
      }

      const jeNum = await getNextJournalNumber(auth.companyId, date);
      const { data: je, error: jeErr } = await s.from('journal_entries')
        .insert({
          company_id: auth.companyId,
          number: jeNum,
          date,
          type: 'general',
          description: `فاتورة مشتريات رقم ${nextNum}`,
          reference_type: 'purchase_invoice',
          reference_id: invoiceId,
          created_by: auth.userId,
        })
        .select('id').single();
      if (jeErr) throw jeErr;
      journalEntryId = je.id;

      const journalLines = [
        { journal_entry_id: journalEntryId, account_id: invAcc.id, debit: subtotal, credit: 0, description: `مشتريات فاتورة رقم ${nextNum}` },
      ];
      if (taxAmount > 0) {
        const { data: vatAcc } = await s.from('accounts').select('id')
          .eq('company_id', auth.companyId).eq('code', ACCOUNT_CODES.VAT_PURCHASES).maybeSingle();
        if (!vatAcc) throw new Error('حساب ضريبة المشتريات (1180) مفقود — فعّل دليل الحسابات أولاً');
        journalLines.push({ journal_entry_id: journalEntryId, account_id: vatAcc.id, debit: taxAmount, credit: 0, description: `ضريبة مشتريات فاتورة رقم ${nextNum}` });
      }
      journalLines.push({ journal_entry_id: journalEntryId, account_id: apAcc.id, debit: 0, credit: total, description: `ذمم موردين فاتورة رقم ${nextNum}` });

      const { error: linesErr } = await insertJournalLines(auth.companyId, journalLines);
      if (linesErr) throw linesErr;

      await s.from('purchase_invoices')
        .update({ journal_entry_id: journalEntryId })
        .eq('id', invoiceId);

      return success({ ...pi, journal_entry_id: journalEntryId, items: computedItems }, 201);
    } catch (txErr) {
      // تراجع آلي: لا فاتورة بدون قيد
      console.error('Purchase invoice creation failed, rolling back:', txErr);
      try {
        if (journalEntryId) {
          await s.from('journal_lines').delete().eq('journal_entry_id', journalEntryId);
          await s.from('journal_entries').delete().eq('id', journalEntryId).eq('company_id', auth.companyId);
        }
        if (invoiceId) {
          await s.from('purchase_invoice_items').delete().eq('purchase_invoice_id', invoiceId);
          await s.from('purchase_invoices').delete().eq('id', invoiceId).eq('company_id', auth.companyId);
        }
      } catch (rollbackErr) {
        console.error('Rollback failed:', rollbackErr);
      }
      throw txErr;
    }
  } catch (err) {
    return handleApiError(err);
  }
}
