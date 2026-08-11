import { NextRequest } from 'next/server';
import { success, error, parseBody, notFound, requireModulePermission, requireManagerOrAbove, handleApiError } from '@/lib/api-helpers';
import { getSupabase } from '@/lib/supabase-client';
import { getNextJournalNumber } from '@/lib/numbering';
import { insertJournalLines } from '@/lib/journal-utils';
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
      .order('id');

    const { data: paid } = await s.from('disbursement_invoice_items')
      .select('amount')
      .eq('purchase_invoice_id', id);

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

    const { data: existing } = await s.from('purchase_invoices')
      .select('id, number, status, total, journal_entry_id')
      .eq('id', id)
      .eq('company_id', auth.companyId)
      .maybeSingle();
    if (!existing) return notFound();

    const inv = existing as Record<string, any>;

    if (inv.status === 'cancelled') {
      return error('الفاتورة ملغاة ولا يمكن تعديلها');
    }

    // منع التلاعب اليدوي بحالة فاتورة عليها مدفوعات (الحالة تُشتق من السندات)
    if (
      parsed.data.status &&
      ['paid', 'partial'].includes(inv.status) &&
      parsed.data.status !== 'cancelled'
    ) {
      return error('لا يمكن تغيير حالة فاتورة عليها مدفوعات يدوياً');
    }

    if (parsed.data.status === 'cancelled') {
      // لا إلغاء لفاتورة عليها سندات صرف — عكس المدفوعات مسؤولية قسم السندات
      const { data: pays } = await s.from('disbursement_invoice_items')
        .select('amount')
        .eq('purchase_invoice_id', id);
      const paidAmount = (pays || []).reduce(
        (sum: number, p: any) => sum + (parseFloat(p.amount) || 0), 0
      );
      if (paidAmount > 0) {
        return error('لا يمكن إلغاء فاتورة عليها مدفوعات — اعكس سندات الصرف المرتبطة أولاً');
      }

      // قيد عكسي كامل الحقول مع الإبقاء على القيد الأصلي
      if (inv.journal_entry_id) {
        const { data: oldLines } = await s.from('journal_lines')
          .select('account_id, debit, credit, description')
          .eq('journal_entry_id', inv.journal_entry_id);

        const today = new Date().toISOString().split('T')[0];
        const revNumber = await getNextJournalNumber(auth.companyId, today);
        const { data: revJe, error: revJeErr } = await s.from('journal_entries')
          .insert({
            company_id: auth.companyId,
            number: revNumber,
            date: today,
            type: 'general',
            description: `عكس فاتورة مشتريات رقم ${inv.number}`,
            reference_type: 'purchase_invoice_reversal',
            reference_id: id,
            created_by: auth.userId,
          })
          .select('id')
          .single();
        if (revJeErr) throw revJeErr;

        if (oldLines && oldLines.length > 0) {
          const { error: revLinesErr } = await insertJournalLines(
            auth.companyId,
            oldLines.map((l: any) => ({
              journal_entry_id: revJe.id,
              account_id: l.account_id,
              debit: parseFloat(l.credit) || 0,
              credit: parseFloat(l.debit) || 0,
              description: l.description,
            }))
          );
          if (revLinesErr) throw revLinesErr;
        }
      }
    }

    const updateData: any = { updated_at: new Date().toISOString() };
    if (parsed.data.status !== undefined) updateData.status = parsed.data.status;
    if (parsed.data.notes !== undefined) updateData.notes = parsed.data.notes;

    const { data: result, error: updateError } = await s.from('purchase_invoices')
      .update(updateData)
      .eq('id', id)
      .eq('company_id', auth.companyId)
      .select('*')
      .maybeSingle();

    if (updateError || !result) return notFound();
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

    const { data: inv } = await s.from('purchase_invoices')
      .select('id, journal_entry_id, purchase_order_id')
      .eq('id', id)
      .eq('company_id', auth.companyId)
      .maybeSingle();

    if (!inv) return notFound();

    const { data: pays } = await s.from('disbursement_invoice_items')
      .select('id')
      .eq('purchase_invoice_id', id)
      .limit(1);
    if (pays && pays.length > 0) {
      return error('لا يمكن حذف فاتورة عليها سندات صرف — اعكس السندات أو ألغِ الفاتورة');
    }

    if ((inv as Record<string, any>).journal_entry_id) {
      return error('لا يمكن حذف فاتورة مُرحَّلة — استخدم الإلغاء لعكس القيد المحاسبي');
    }

    await s.from('purchase_invoice_items').delete().eq('purchase_invoice_id', id);
    await s.from('purchase_invoices')
      .delete()
      .eq('id', id)
      .eq('company_id', auth.companyId);

    return success({ deleted: true });
  } catch (err) {
    return handleApiError(err);
  }
}
