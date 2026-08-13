import { NextRequest } from 'next/server';
import { success, error, notFound, parseBody, requireApiAuth, handleApiError, requireModulePermission } from '@/lib/api-helpers';
import { getSupabase } from '@/lib/supabase-client';
import { createJournalEntry } from '@/lib/journal-utils';
import { ACCOUNT_CODES } from '@/lib/constants';
import { generateId } from '@/lib/utils';

const sb = () => getSupabase();

/**
 * POST /api/quotations/[id]/convert
 * تحويل عرض السعر إلى مشروع
 */
export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const auth = await requireModulePermission(req, 'quotations', 'create');
    const { id } = await params;
    const s = sb();
    const body = await parseBody(req);

    const { data: quotation, error: quotErr } = await s.from('quotations')
      .select('*, quotation_items(*)')
      .eq('id', id)
      .eq('company_id', auth.companyId)
      .maybeSingle();

    if (quotErr) throw quotErr;
    if (!quotation) return notFound();

    if ((quotation as any).status === 'converted') {
      return error('هذا العرض محول بالفعل إلى مشروع');
    }

    const contractValue = parseFloat((quotation as any).total) || 0;
    const startDate = body.start_date || new Date().toISOString().split('T')[0];
    const endDate = body.end_date || null;
    const projectId = generateId();

    // 1. إنشاء المشروع
    const { data: project, error: projErr } = await s.from('projects')
      .insert({
        id: projectId,
        company_id: auth.companyId,
        name: body.name || `مشروع - ${(quotation as any).number}`,
        client_id: (quotation as any).contact_id,
        contract_value: contractValue,
        start_date: startDate,
        end_date: endDate,
        status: 'active',
        description: `محول من عرض سعر رقم: ${(quotation as any).number}`,
        created_by: auth.userId,
      })
      .select('*')
      .single();

    if (projErr) throw projErr;

    const projectName = (project as any).name;

    // 2. نسخ بنود العرض كبنود BOQ
    const items = (quotation as any).quotation_items || [];
    if (items.length > 0) {
      const boqItems = items.map((item: any, idx: number) => ({
        company_id: auth.companyId,
        project_id: projectId,
        item_code: `BOQ-${String(idx + 1).padStart(3, '0')}`,
        description: item.description,
        unit: 'وحدة',
        quantity: item.quantity,
        unit_price: item.unit_price,
        total: item.quantity * item.unit_price,
      }));
      await s.from('boq_items').insert(boqItems);
    }

    // 3. إنشاء فاتورة + قيد محاسبي (نموذج حسابات التحكم: 1130 + contact_id)
    const invoiceId = generateId();

    const { resolveAccountId } = await import('@/lib/voucher-utils');
    const arAccountId = await resolveAccountId(auth.companyId, ACCOUNT_CODES.ACCOUNTS_RECEIVABLE);
    const { data: revAcc } = await s.from('accounts')
      .select('id')
      .eq('code', ACCOUNT_CODES.CONTRACT_REVENUE)
      .eq('company_id', auth.companyId)
      .maybeSingle();

    if (!arAccountId || !revAcc) {
      // تراجع كامل: لا مشروع محول بلا قيد
      await s.from('boq_items').delete().eq('project_id', projectId).eq('company_id', auth.companyId);
      await s.from('projects').delete().eq('id', projectId).eq('company_id', auth.companyId);
      return error('حسابات التحويل (1130 / 4100) غير موجودة — راجع دليل الحسابات');
    }

    const vatAmount = parseFloat((quotation as any).tax_amount) || parseFloat((quotation as any).vat_amount) || 0;
    const subtotal = parseFloat((quotation as any).subtotal) || contractValue;
    let vatAccId: string | null = null;
    if (vatAmount > 0) {
      const { data: vatAcc } = await s.from('accounts')
        .select('id')
        .eq('code', ACCOUNT_CODES.VAT_SALES)
        .eq('company_id', auth.companyId)
        .maybeSingle();
      if (!vatAcc) {
        await s.from('boq_items').delete().eq('project_id', projectId).eq('company_id', auth.companyId);
        await s.from('projects').delete().eq('id', projectId).eq('company_id', auth.companyId);
        return error('حساب ضريبة المبيعات (2120) غير موجود');
      }
      vatAccId = vatAcc.id;
    }

    const lines = [
      {
        account_id: arAccountId,
        debit: subtotal + vatAmount,
        credit: 0,
        description: `فاتورة مشروع محول من عرض: ${(quotation as any).number}`,
        project_id: projectId,
        contact_id: (quotation as any).contact_id,
      },
      {
        account_id: revAcc.id,
        debit: 0,
        credit: subtotal,
        description: `إيرادات عقد - مشروع محول`,
        project_id: projectId,
        contact_id: (quotation as any).contact_id,
      },
    ];
    if (vatAmount > 0 && vatAccId) {
      lines.push({
        account_id: vatAccId,
        debit: 0,
        credit: vatAmount,
        description: `ضريبة قيمة مضافة`,
        project_id: projectId,
        contact_id: (quotation as any).contact_id,
      });
    }

    const je = await createJournalEntry(auth.companyId, {
      date: startDate,
      type: 'general',
      description: `فاتورة مشروع محول من عرض سعر: ${(quotation as any).number}`,
      lines,
      reference_type: 'quotation_conversion',
      reference_id: id,
      created_by: auth.userId,
    });

    if (je.error || !je.journalId) {
      await s.from('boq_items').delete().eq('project_id', projectId).eq('company_id', auth.companyId);
      await s.from('projects').delete().eq('id', projectId).eq('company_id', auth.companyId);
      throw je.error || new Error('فشل قيد التحويل');
    }
    const journalEntryId = je.journalId;

    // إنشاء الفاتورة
    const invoiceNumber = `INV-${projectId.substring(0, 8).toUpperCase()}`;
    await s.from('invoices').insert({
      id: invoiceId,
      company_id: auth.companyId,
      number: invoiceNumber,
      contact_id: (quotation as any).contact_id,
      project_id: projectId,
      date: startDate,
      due_date: startDate,
      subtotal: subtotal,
      tax_rate: parseFloat((quotation as any).tax_rate) || parseFloat((quotation as any).vat_rate) || 0,
      tax_amount: vatAmount,
      total: contractValue,
      paid_amount: 0,
      status: 'unpaid',
      journal_entry_id: journalEntryId,
      created_by: auth.userId,
    });

    // إنشاء بنود الفاتورة
    if (items.length > 0) {
      const invItems = items.map((item: any) => ({
        id: generateId(),
        company_id: auth.companyId,
        invoice_id: invoiceId,
        description: item.description,
        quantity: item.quantity,
        unit_price: item.unit_price,
        total: item.quantity * item.unit_price,
      }));
      await s.from('invoice_items').insert(invItems);
    }

    // 4. تحديث حالة العرض (مُقيَّد بالشركة لمنع العبث بين المستأجرين)
    const { error: qUpdErr } = await s.from('quotations')
      .update({ status: 'converted', project_id: projectId })
      .eq('id', id).eq('company_id', auth.companyId);
    if (qUpdErr) {
      await s.from('invoice_items').delete().eq('invoice_id', invoiceId).eq('company_id', auth.companyId);
      await s.from('journal_lines').delete().eq('journal_entry_id', journalEntryId).eq('company_id', auth.companyId);
      await s.from('journal_entries').delete().eq('id', journalEntryId).eq('company_id', auth.companyId);
      await s.from('invoices').delete().eq('id', invoiceId).eq('company_id', auth.companyId);
      throw qUpdErr;
    }

    const { data: projectFull } = await s.from('projects')
      .select('*, contacts(name)')
      .eq('id', projectId).eq('company_id', auth.companyId)
      .single();

    const result = projectFull as Record<string, any>;
    result.client_name = result.contacts?.name || null;
    result.invoice = { id: invoiceId, number: invoiceNumber };
    result.boq_items_count = items.length;

    return success(result, 201);
  } catch (err) {
    return handleApiError(err);
  }
}
