import { NextRequest } from 'next/server';
import { success, error, requireApiAuth, handleApiError, parseBody, getPaginationParams } from '@/lib/api-helpers';
import { getSupabase } from '@/lib/supabase-client';
import { createJournalEntry } from '@/lib/journal-utils';
import { ACCOUNT_CODES } from '@/lib/constants';

const sb = () => getSupabase();

/**
 * GET /api/credit-notes?projectId=&invoiceId=
 */
export async function GET(request: NextRequest) {
  try {
    const auth = await requireApiAuth(request);
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
    const auth = await requireApiAuth(request);
    const s = sb();
    const body = await parseBody(request);
    const { invoice_id, project_id, contact_id, reason, items, date } = body;

    if (!reason) return error('السبب مطلوب');
    if (!items || !Array.isArray(items) || items.length === 0) return error('يجب إضافة بند واحد على الأقل');

    // Get linked invoice's tax rate if invoice_id provided
    let taxRate = body.tax_rate || 0;
    let linkedContactId = contact_id || null;

    if (invoice_id) {
      const { data: linkedInvoice } = await s.from('invoices')
        .select('tax_rate, contact_id, project_id')
        .eq('id', invoice_id).eq('company_id', auth.companyId).maybeSingle();

      if (linkedInvoice) {
        const inv = linkedInvoice as any;
        taxRate = parseFloat(inv.tax_rate) || 0;
        if (inv.contact_id) linkedContactId = inv.contact_id;
        if (inv.project_id && !project_id) {
          // inherit project from invoice
        }
      }
    }

    const subtotal = items.reduce((sum: number, it: any) => sum + (it.quantity * it.unit_price || 0), 0);
    const taxAmount = subtotal * taxRate;
    const total = subtotal + taxAmount;

    // Generate credit note number (own sequence, not invoice sequence)
    const year = new Date().getFullYear();
    let number: number;
    const { data: seqData } = await s.from('credit_note_sequences')
      .select('last_number').eq('company_id', auth.companyId).eq('year', year).maybeSingle();

    if (seqData) {
      number = (seqData as any).last_number + 1;
      await s.from('credit_note_sequences').update({ last_number: number }).eq('company_id', auth.companyId).eq('year', year);
    } else {
      number = 1;
      await s.from('credit_note_sequences').insert({ company_id: auth.companyId, year, last_number: 1 });
    }

    // Insert credit note
    const { data: cn, error: cnErr } = await s.from('credit_notes')
      .insert({
        company_id: auth.companyId,
        number: `CN-${number}`,
        invoice_id: invoice_id || null,
        project_id: project_id || null,
        contact_id: linkedContactId,
        date: date || new Date().toISOString().split('T')[0],
        reason,
        subtotal,
        tax_rate: taxRate,
        tax_amount: taxAmount,
        total,
        status: 'approved',
        created_by: auth.userId,
      })
      .select('*').single();

    if (cnErr) throw cnErr;

    // Insert items
    for (const item of items) {
      await s.from('credit_note_items').insert({
        company_id: auth.companyId,
        credit_note_id: cn.id,
        description: item.description,
        quantity: item.quantity,
        unit_price: item.unit_price,
        total: item.quantity * item.unit_price,
      });
    }

    // Create reversal journal entry
    // Credit note = reverse the original invoice entry
    // Debit Revenue (4100), Debit VAT (2120) / Credit AR (1130)
    const { data: arAccount } = await s.from('accounts').select('id').eq('company_id', auth.companyId).eq('code', ACCOUNT_CODES.ACCOUNTS_RECEIVABLE).maybeSingle();
    const { data: revAccount } = await s.from('accounts').select('id').eq('company_id', auth.companyId).eq('code', ACCOUNT_CODES.CONTRACT_REVENUE).maybeSingle();
    const { data: vatAccount } = await s.from('accounts').select('id').eq('company_id', auth.companyId).eq('code', ACCOUNT_CODES.VAT_SALES).maybeSingle();

    if (arAccount && revAccount) {
      const journalLines: any[] = [
        {
          account_id: revAccount.id,
          debit: subtotal,
          credit: 0,
          description: `إشعار دائن: ${reason}`,
          project_id: project_id || null,
          contact_id: linkedContactId,
        },
        {
          account_id: arAccount.id,
          debit: 0,
          credit: total,
          description: `إشعار دائن: ${reason}`,
          project_id: project_id || null,
          contact_id: linkedContactId,
        },
      ];

      if (taxAmount > 0 && vatAccount) {
        journalLines.push({
          account_id: vatAccount.id,
          debit: taxAmount,
          credit: 0,
          description: `ضريبة إشعار دائن: ${reason}`,
          project_id: project_id || null,
          contact_id: linkedContactId,
        });
      }

      const je = await createJournalEntry(auth.companyId, {
        date: date || new Date().toISOString().split('T')[0],
        type: 'general',
        description: `إشعار دائن ${cn.number} - ${reason}`,
        lines: journalLines,
        reference_type: 'credit_note',
        reference_id: cn.id,
        created_by: auth.userId,
      });

      if (!je.error) {
        await s.from('credit_notes').update({ journal_entry_id: je.journalId }).eq('id', cn.id);
      }
    }

    return success(cn, 201);
  } catch (err) {
    return handleApiError(err);
  }
}
