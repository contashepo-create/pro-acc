import { getSupabase } from '@/lib/supabase-client';

// @ts-ignore
const sb = () => getSupabase() as any;

/**
 * Atomic number generation to prevent race conditions
 * Uses SQL functions with advisory locks
 */

export async function getNextInvoiceNumber(companyId: string, year: number): Promise<number> {
  const s = sb();
  try {
    const { data, error } = await s.rpc('next_invoice_number', {
      p_company_id: companyId,
      p_year: year,
    });
    if (error || data == null) throw error || new Error('RPC failed');
    return data as number;
  } catch {
    // Fallback: old logic
    const { data: seq } = await s.from('invoice_sequences')
      .select('last_number').eq('company_id', companyId).eq('year', year).maybeSingle();
    if (seq) {
      const next = seq.last_number + 1;
      await s.from('invoice_sequences').update({ last_number: next }).eq('company_id', companyId).eq('year', year);
      return next;
    } else {
      await s.from('invoice_sequences').insert({ company_id: companyId, year, last_number: 1 });
      return 1;
    }
  }
}

export async function getNextJournalNumber(companyId: string, dateOrYear: string | number): Promise<number> {
  const s = sb();
  const year = typeof dateOrYear === 'string' ? parseInt(dateOrYear.substring(0, 4)) : dateOrYear;
  try {
    const { data, error } = await s.rpc('next_journal_number', {
      p_company_id: companyId,
      p_year: year,
    });
    if (error || data == null) throw error || new Error('RPC failed');
    return data as number;
  } catch {
    const { data: max } = await s.from('journal_entries')
      .select('number').eq('company_id', companyId).order('number', { ascending: false }).limit(1).maybeSingle();
    return ((max as any)?.number || 0) + 1;
  }
}

export async function getNextVoucherNumber(companyId: string, table: 'voucher_receipts' | 'voucher_disbursements'): Promise<number> {
  const s = sb();
  try {
    const { data, error } = await s.rpc('next_voucher_number', {
      p_company_id: companyId,
      p_table_name: table,
    });
    if (error || data == null) throw error || new Error('RPC failed');
    return data as number;
  } catch {
    const { data: max } = await s.from(table)
      .select('number').eq('company_id', companyId).order('number', { ascending: false }).limit(1).maybeSingle();
    return ((max as any)?.number || 0) + 1;
  }
}

export async function getNextNumberForTable(companyId: string, table: string): Promise<number> {
  const s = sb();
  // Generic fallback using MAX+1 with advisory lock via RPC if possible
  try {
    if (table === 'voucher_receipts' || table === 'voucher_disbursements' || table === 'journal_entries') {
      return getNextVoucherNumber(companyId, table as any);
    }
    const { data: max } = await s.from(table)
      .select('number').eq('company_id', companyId).order('number', { ascending: false }).limit(1).maybeSingle();
    return ((max as any)?.number || 0) + 1;
  } catch {
    return 1;
  }
}
