import { NextRequest } from 'next/server';
import { success, error, requireApiAuth, handleApiError, parseBody, getPaginationParams, requireModulePermission } from '@/lib/api-helpers';
import { getSupabase } from '@/lib/supabase-client';
import { createJournalEntry } from '@/lib/journal-utils';
import { ACCOUNT_CODES } from '@/lib/constants';

const sb = () => getSupabase();

/**
 * GET /api/credit-notes?projectId=&invoiceId=
 */
export async function GET(request: NextRequest) {
  try {
    const auth = await requireModulePermission(request, 'credit_notes', 'read');
    const s = sb();
    const url = new URL(request.url);
    const { page, pageSize } = getPaginationParams(url);
    const projectId = url.searchParams.get('projectId');
    const invoiceId = url.searchParams.get('invoiceId');

    let query = s.from('credit_notes')
      .select('*, contacts(name), invoices(number), projects(name)', { count: 'exact' })
      .eq('company_id', auth.companyId);

    if (projectId) query = query.eq('project_id', projectId);
    if (invoiceId) query = query.eq('invoice_id', invoiceId);

    const offset = (page - 1) * pageSize;
    const { data, error: err, count } = await query
      .order('date', { ascending: false })
      .range(offset, offset + pageSize - 1);

    if (err) {
      console.warn('Credit notes query error:', err);
      return success({ credit_notes: [], total: 0, page, pageSize });
    }

    const creditNotes = (data || []).map((cn: any) => ({
      ...cn,
      contact_name: cn.contacts?.name || null,
      invoice_number: cn.invoices?.number || null,
      project_name: cn.projects?.name || null,
    }));

    return success({ credit_notes: creditNotes, total: count || 0, page, pageSize });
  } catch (err) {
    return handleApiError(err);
  }
}

/**
 * POST /api/credit-notes
 * Create a credit note with proper journal entry
 */
export async function POST(request: NextRequest) {
  try {
    const auth = await requireModulePermission(request, 'credit_notes', 'create');
    const s = sb();
    const body = await parseBody(request);
    const { invoice_id, project_id, contact_id, reason, items, date } = body;

    if (typeof reason !== 'string' || !reason.trim() || reason.length > 1000) return error('السبب مطلوب');
    if (!Array.isArray(items) || items.length === 0 || items.length > 200) return error('يجب إضافة بند واحد على الأقل');
    const normalizedItems = items.map((item: any) => ({
      description: typeof item.description === 'string' ? item.description.trim() : '',
      quantity: Number(item.quantity), unit_price: Number(item.unit_price),
    }));
    if (normalizedItems.some((item: any) => !item.description || item.description.length > 500 || !Number.isFinite(item.quantity) || item.quantity <= 0 || !Number.isFinite(item.unit_price) || item.unit_price < 0)) return error('أحد بنود الإشعار غير صالح');

    let taxRate = Number(body.tax_rate || 0);
    let linkedContactId = contact_id || null;
    let linkedProjectId = project_id || null;
    let invoiceTotal: number | null = null;
    if (invoice_id) {
      const { data: linkedInvoice } = await s.from('invoices')
        .select('tax_rate, contact_id, project_id, total, status')
        .eq('id', invoice_id).eq('company_id', auth.companyId).maybeSingle();
      if (!linkedInvoice) return error('الفاتورة غير موجودة', 404);
      const inv = linkedInvoice as any;
      if (inv.status === 'cancelled') return error('لا يمكن إصدار إشعار لفاتورة ملغاة', 409);
      taxRate = Number(inv.tax_rate) || 0;
      linkedContactId = inv.contact_id || null;
      linkedProjectId = inv.project_id || null;
      invoiceTotal = Number(inv.total) || 0;
    } else {
      if (linkedContactId) {
        const { data: contact } = await s.from('contacts').select('id').eq('id', linkedContactId).eq('company_id', auth.companyId).maybeSingle();
        if (!contact) return error('الطرف غير موجود', 404);
      }
      if (linkedProjectId) {
        const { data: project } = await s.from('projects').select('id').eq('id', linkedProjectId).eq('company_id', auth.companyId).maybeSingle();
        if (!project) return error('المشروع غير موجود', 404);
      }
    }
    if (!Number.isFinite(taxRate) || taxRate < 0 || taxRate > 1) return error('نسبة الضريبة غير صالحة');
    const round2 = (value: number) => Math.round((value + Number.EPSILON) * 100) / 100;
    const computedItems = normalizedItems.map((item: any) => ({ ...item, total: round2(item.quantity * item.unit_price) }));
    const subtotal = round2(computedItems.reduce((sum: number, it: any) => sum + it.total, 0));
    const taxAmount = round2(subtotal * taxRate);
    const total = round2(subtotal + taxAmount);
    if (total <= 0) return error('إجمالي الإشعار يجب أن يكون موجباً');
    if (invoice_id && invoiceTotal !== null) {
      const { data: priorCredits } = await s.from('credit_notes').select('total')
        .eq('company_id', auth.companyId).eq('invoice_id', invoice_id).eq('status', 'approved').is('deleted_at', null);
      const credited = (priorCredits || []).reduce((sum: number, row: any) => sum + Number(row.total || 0), 0);
      if (total > invoiceTotal - credited + 0.005) return error('يتجاوز الإشعار الرصيد المتبقي للفاتورة', 409);
    }

    const effectiveDate = date || new Date().toISOString().split('T')[0];
    if (!Number.isFinite(Date.parse(effectiveDate))) return error('تاريخ الإشعار غير صالح');
    const year = Number(effectiveDate.slice(0, 4));
    const { data: nextNumber, error: numberError } = await s.rpc('next_credit_note_number', {
      p_company_id: auth.companyId, p_year: year,
    });
    if (numberError || nextNumber == null) throw numberError || new Error('تعذر إنشاء رقم الإشعار');
    const number = Number(nextNumber);

    // حل الحسابات قبل أي كتابة — القيد العكسي إلزامي متوازن
    const { data: arAccount } = await s.from('accounts').select('id').eq('company_id', auth.companyId).eq('code', ACCOUNT_CODES.ACCOUNTS_RECEIVABLE).maybeSingle();
    const { data: revAccount } = await s.from('accounts').select('id').eq('company_id', auth.companyId).eq('code', ACCOUNT_CODES.CONTRACT_REVENUE).maybeSingle();
    if (!arAccount || !revAccount) {
      return error('حسابات الذمم (1130) أو الإيرادات (4100) غير موجودة — راجع دليل الحسابات');
    }
    let vatAccountId: string | null = null;
    if (taxAmount > 0) {
      const { data: vatAccount } = await s.from('accounts').select('id').eq('company_id', auth.companyId).eq('code', ACCOUNT_CODES.VAT_SALES).maybeSingle();
      if (!vatAccount) return error('حساب ضريبة المبيعات (2120) غير موجود');
      vatAccountId = vatAccount.id;
    }

    // Insert credit note
    const { data: cn, error: cnErr } = await s.from('credit_notes')
      .insert({
        company_id: auth.companyId,
        number,
        invoice_id: invoice_id || null,
        project_id: linkedProjectId,
        contact_id: linkedContactId,
        date: effectiveDate,
        reason: reason.trim(),
        subtotal,
        tax_rate: taxRate,
        tax_amount: taxAmount,
        total,
        status: 'approved',
        created_by: auth.userId,
      })
      .select('*').single();

    if (cnErr) throw cnErr;

    const { error: itemErr } = await s.from('credit_note_items').insert(
      computedItems.map((item: any) => ({ company_id: auth.companyId, credit_note_id: cn.id, ...item })),
    );
    if (itemErr) {
      await s.from('credit_notes').delete().eq('id', cn.id).eq('company_id', auth.companyId);
      throw itemErr;
    }

    // Create reversal journal entry — فشله يلغي الإشعار بالكامل
    const journalLines: any[] = [
      { account_id: revAccount.id, debit: subtotal, credit: 0, description: `إشعار دائن: ${reason}`, project_id: linkedProjectId, contact_id: linkedContactId },
      { account_id: arAccount.id, debit: 0, credit: total, description: `إشعار دائن: ${reason}`, project_id: linkedProjectId, contact_id: linkedContactId },
    ];
    if (taxAmount > 0 && vatAccountId) {
      journalLines.push({ account_id: vatAccountId, debit: taxAmount, credit: 0, description: `ضريبة إشعار دائن: ${reason}`, project_id: linkedProjectId, contact_id: linkedContactId });
    }

    const je = await createJournalEntry(auth.companyId, {
      date: effectiveDate,
      type: 'general',
      description: `إشعار دائن ${cn.number} - ${reason}`,
      lines: journalLines,
      reference_type: 'credit_note',
      reference_id: cn.id,
      created_by: auth.userId,
    });

    if (je.error || !je.journalId) {
      await s.from('credit_note_items').delete().eq('credit_note_id', cn.id);
      await s.from('credit_notes').delete().eq('id', cn.id).eq('company_id', auth.companyId);
      throw je.error || new Error('فشل قيد الإشعار الدائن');
    }

    const { data: linked, error: linkErr } = await s.from('credit_notes')
      .update({ journal_entry_id: je.journalId })
      .eq('id', cn.id)
      .eq('company_id', auth.companyId)
      .select('*')
      .single();
    if (linkErr) {
      await s.from('journal_lines').delete().eq('journal_entry_id', je.journalId).eq('company_id', auth.companyId);
      await s.from('journal_entries').delete().eq('id', je.journalId).eq('company_id', auth.companyId);
      await s.from('credit_note_items').delete().eq('credit_note_id', cn.id).eq('company_id', auth.companyId);
      await s.from('credit_notes').delete().eq('id', cn.id).eq('company_id', auth.companyId);
      throw linkErr;
    }

    return success(linked, 201);
  } catch (err) {
    return handleApiError(err);
  }
}
