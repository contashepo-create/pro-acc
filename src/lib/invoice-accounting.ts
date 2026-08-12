/**
 * ترحيل فاتورة مبيعات: ذمم / إيراد / ضريبة.
 * التحصيل النقدي يُسجَّل كسند قبض منفصل + تخصيص (Open Items).
 */
import { getSupabase } from '@/lib/supabase-client';
import { insertJournalHeader, insertJournalLines } from '@/lib/journal-utils';
import { createDefaultChartOfAccounts } from '@/lib/default-accounts';

const sb = () => getSupabase();

export async function resolveSalesAccounts(companyId: string): Promise<{
  arId: string;
  revenueId: string;
  vatId: string | null;
}> {
  const s = sb();
  let { data: ar } = await s.from('accounts').select('id').eq('company_id', companyId).eq('code', '1130').maybeSingle();
  let { data: rev } = await s.from('accounts').select('id').eq('company_id', companyId).eq('code', '4100').maybeSingle();
  let { data: vat } = await s.from('accounts').select('id').eq('company_id', companyId).eq('code', '2120').maybeSingle();
  if (!ar || !rev) {
    await createDefaultChartOfAccounts(s, companyId);
    ar = (await s.from('accounts').select('id').eq('company_id', companyId).eq('code', '1130').maybeSingle()).data;
    rev = (await s.from('accounts').select('id').eq('company_id', companyId).eq('code', '4100').maybeSingle()).data;
    vat = (await s.from('accounts').select('id').eq('company_id', companyId).eq('code', '2120').maybeSingle()).data;
  }
  if (!ar || !rev) throw new Error('حسابات الذمم أو الإيراد مفقودة');
  return { arId: ar.id, revenueId: rev.id, vatId: vat?.id || null };
}

export async function postSalesInvoiceJournal(opts: {
  companyId: string;
  userId: string;
  invoiceId: string;
  invoiceNumber: number | string;
  date: string;
  contactId: string;
  projectId?: string | null;
  subtotal: number;
  vatAmount: number;
  total: number;
}): Promise<string> {
  const { arId, revenueId, vatId } = await resolveSalesAccounts(opts.companyId);
  const { data: header, error: hErr } = await insertJournalHeader(opts.companyId, {
    date: opts.date,
    type: 'general',
    description: `فاتورة مبيعات رقم ${opts.invoiceNumber}`,
    reference_type: 'invoice',
    reference_id: opts.invoiceId,
    created_by: opts.userId,
  });
  if (hErr || !header) throw hErr || new Error('فشل قيد الفاتورة');

  const lines: Array<{
    journal_entry_id: string;
    account_id: string;
    debit: number;
    credit: number;
    description: string;
    contact_id?: string | null;
    project_id?: string | null;
  }> = [
    {
      journal_entry_id: header.id,
      account_id: arId,
      debit: opts.total,
      credit: 0,
      description: `ذمم فاتورة رقم ${opts.invoiceNumber}`,
      contact_id: opts.contactId,
      project_id: opts.projectId || null,
    },
    {
      journal_entry_id: header.id,
      account_id: revenueId,
      debit: 0,
      credit: opts.subtotal,
      description: `إيراد فاتورة رقم ${opts.invoiceNumber}`,
      project_id: opts.projectId || null,
    },
  ];
  if (opts.vatAmount > 0 && vatId) {
    lines.push({
      journal_entry_id: header.id,
      account_id: vatId,
      debit: 0,
      credit: opts.vatAmount,
      description: `ضريبة فاتورة رقم ${opts.invoiceNumber}`,
    });
  }
  const { error: lErr } = await insertJournalLines(opts.companyId, lines);
  if (lErr) {
    await sb().from('journal_lines').delete().eq('journal_entry_id', header.id);
    await sb().from('journal_entries').delete().eq('id', header.id).eq('company_id', opts.companyId);
    throw lErr;
  }
  await sb().from('invoices').update({ journal_entry_id: header.id }).eq('id', opts.invoiceId).eq('company_id', opts.companyId);
  return header.id;
}
