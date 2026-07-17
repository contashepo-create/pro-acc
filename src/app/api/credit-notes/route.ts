import { NextRequest } from 'next/server';
import { getSupabase } from '@/lib/supabase-client';
import { requireApiAuth, handleApiError, success, error, parseBody } from '@/lib/api-helpers';
import { getNextJournalNumber } from '@/lib/numbering';

// @ts-ignore
const sb = () => getSupabase() as any;

export async function GET(request: NextRequest) {
  try {
    const auth = await requireApiAuth(request);
    const s = sb();
    const url = new URL(request.url);
    const page = parseInt(url.searchParams.get('page') || '1', 10);
    const pageSize = Math.min(100, parseInt(url.searchParams.get('pageSize') || '50', 10));

    const offset = (page - 1) * pageSize;
    const { data, error: err, count } = await s.from('credit_notes')
      .select('*, invoices(number), contacts(name)', { count: 'exact' })
      .eq('company_id', auth.companyId)
      .is('deleted_at', null)
      .order('date', { ascending: false })
      .range(offset, offset + pageSize - 1);

    if (err) throw err;

    return success({ credit_notes: data || [], total: count || 0, page, pageSize });
  } catch (err) {
    return handleApiError(err);
  }
}

export async function POST(request: NextRequest) {
  try {
    const auth = await requireApiAuth(request);
    const s = sb();
    const body = await parseBody(request);
    const { invoice_id, reason, items } = body;

    if (!reason) return error('السبب مطلوب');
    if (!items || !Array.isArray(items) || items.length === 0) return error('يجب إضافة بند واحد على الأقل');

    // Get next number
    const year = new Date().getFullYear();
    let number = 1;
    try {
      const { data } = await s.rpc('next_invoice_number', { p_company_id: auth.companyId, p_year: year });
      number = data as number;
    } catch {
      const { data: max } = await s.from('credit_notes').select('number').eq('company_id', auth.companyId).order('number', { ascending: false }).limit(1).maybeSingle();
      number = ((max as any)?.number || 0) + 1;
    }

    const subtotal = items.reduce((sum: number, it: any) => sum + (it.quantity * it.unit_price || 0), 0);
    const vatRate = 0.15;
    const vatAmount = subtotal * vatRate;
    const total = subtotal + vatAmount;

    // Start transaction-like
    let creditNoteId: string | null = null;
    let journalId: string | null = null;

    try {
      const { data: cn, error: cnErr } = await s.from('credit_notes')
        .insert({
          company_id: auth.companyId,
          number,
          invoice_id: invoice_id || null,
          date: new Date().toISOString().split('T')[0],
          reason,
          subtotal,
          vat_amount: vatAmount,
          total,
          status: 'approved',
          created_by: auth.userId,
        })
        .select()
        .single();

      if (cnErr) throw cnErr;
      creditNoteId = cn.id;

      for (const item of items) {
        await s.from('credit_note_items').insert({
          credit_note_id: creditNoteId,
          description: item.description,
          quantity: item.quantity,
          unit_price: item.unit_price,
          total: item.quantity * item.unit_price,
        });
      }

      // Create reversal journal entry
      const jeNumber = await getNextJournalNumber(auth.companyId, new Date().toISOString());
      const { data: je } = await s.from('journal_entries')
        .insert({
          company_id: auth.companyId,
          number: jeNumber,
          date: new Date().toISOString().split('T')[0],
          type: 'general',
          description: `إشعار دائن ${number} - ${reason}`,
          reference: `CN-${number}`,
          created_by: auth.userId,
        })
        .select('id')
        .single();

      journalId = je.id;

      // Get accounts
      const { data: arAccount } = await s.from('accounts').select('id').eq('company_id', auth.companyId).eq('code', '1130').maybeSingle();
      const { data: revAccount } = await s.from('accounts').select('id').eq('company_id', auth.companyId).eq('code', '4100').maybeSingle();
      const { data: vatAccount } = await s.from('accounts').select('id').eq('company_id', auth.companyId).eq('code', '2120').maybeSingle();

      if (arAccount && revAccount) {
        const lines: any[] = [
          { journal_entry_id: journalId, account_id: revAccount.id, account_code: '4100', debit: subtotal, credit: 0, description: `مرتجع فاتورة ${number}` },
          { journal_entry_id: journalId, account_id: arAccount.id, account_code: '1130', debit: 0, credit: total, description: `إشعار دائن ${number}` },
        ];
        if (vatAccount && vatAmount > 0) {
          lines.push({ journal_entry_id: journalId, account_id: vatAccount.id, account_code: '2120', debit: vatAmount, credit: 0, description: `ضريبة مرتجع ${number}` });
        }
        await s.from('journal_lines').insert(lines);
      }

      await s.from('credit_notes').update({ journal_entry_id: journalId }).eq('id', creditNoteId);

      // Audit log
      await s.from('financial_audit_log').insert({
        company_id: auth.companyId,
        user_id: auth.userId,
        action: 'create_credit_note',
        table_name: 'credit_notes',
        record_id: creditNoteId,
        new_values: { number, total, reason },
      });

      return success({ ...cn, journal_entry_id: journalId }, 201);
    } catch (txErr) {
      // Rollback
      if (journalId) {
        await s.from('journal_lines').delete().eq('journal_entry_id', journalId);
        await s.from('journal_entries').delete().eq('id', journalId);
      }
      if (creditNoteId) {
        await s.from('credit_note_items').delete().eq('credit_note_id', creditNoteId);
        await s.from('credit_notes').delete().eq('id', creditNoteId);
      }
      throw txErr;
    }
  } catch (err) {
    return handleApiError(err);
  }
}
