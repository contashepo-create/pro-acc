import { getSupabase } from '@/lib/supabase-client';

const sb = () => getSupabase();

// Type definitions for fallback queries
interface SequenceRow { last_number: number }
interface NumberRow { number: number }
interface InvoiceNumberRow { invoice_number: number }
interface PONumberRow { po_number: number }

/**
 * Atomic number generation to prevent race conditions
 * Uses SQL functions with advisory locks
 */

async function maxExisting(table: string, companyId: string, columns: string[]): Promise<number> {
  const s = sb();
  let max = 0;
  for (const col of columns) {
    const { data } = await s.from(table)
      .select(col)
      .eq('company_id', companyId)
      .order(col, { ascending: false })
      .limit(1)
      .maybeSingle();
    const n = Number((data as unknown as Record<string, number> | null)?.[col]) || 0;
    if (n > max) max = n;
  }
  return max;
}

export async function getNextInvoiceNumber(companyId: string, year: number): Promise<number> {
  const s = sb();
  let candidate = 0;
  try {
    const { data, error } = await s.rpc('next_invoice_number', {
      p_company_id: companyId,
      p_year: year,
    });
    if (error || data == null) throw error || new Error('RPC failed');
    candidate = data as number;
  } catch {
    const { data: seq } = await s.from('invoice_sequences')
      .select('last_number').eq('company_id', companyId).eq('year', year).maybeSingle();
    if (seq) {
      const row = seq as unknown as SequenceRow;
      candidate = row.last_number + 1;
      await s.from('invoice_sequences').update({ last_number: candidate }).eq('company_id', companyId).eq('year', year);
    } else {
      await s.from('invoice_sequences').insert({ company_id: companyId, year, last_number: 1 });
      candidate = 1;
    }
  }
  // UNIQUE(company_id, number) is company-wide, not per year.
  const maxExistingNum = await maxExisting('invoices', companyId, ['number']);
  return Math.max(candidate || 1, maxExistingNum + 1);
}

export async function getNextJournalNumber(companyId: string, dateOrYear: string | number): Promise<number> {
  const s = sb();
  const year = typeof dateOrYear === 'string' ? parseInt(dateOrYear.substring(0, 4)) : dateOrYear;
  let candidate = 0;
  try {
    const { data, error } = await s.rpc('next_journal_number', {
      p_company_id: companyId,
      p_year: year,
    });
    if (error || data == null) throw error || new Error('RPC failed');
    candidate = data as number;
  } catch {
    const { data: seq } = await s.from('journal_sequences')
      .select('last_number').eq('company_id', companyId).eq('year', year).maybeSingle();
    if (seq) {
      const row = seq as unknown as SequenceRow;
      candidate = row.last_number + 1;
      await s.from('journal_sequences').update({ last_number: candidate }).eq('company_id', companyId).eq('year', year);
    } else {
      await s.from('journal_sequences').insert({ company_id: companyId, year, last_number: 1 });
      candidate = 1;
    }
  }

  // UNIQUE is (company_id, number) — not per year. A yearly sequence of 1
  // collides with last year's journal #1 (and with leftover invoice numbers
  // that were historically reused as journal numbers). Always take the
  // company-wide max + 1 when it is higher.
  const { data: maxRow } = await s.from('journal_entries')
    .select('number')
    .eq('company_id', companyId)
    .order('number', { ascending: false })
    .limit(1)
    .maybeSingle();
  const maxExisting = Number((maxRow as NumberRow | null)?.number) || 0;
  return Math.max(candidate || 1, maxExisting + 1);
}

export function isUniqueViolation(err: unknown): boolean {
  const e = err as { code?: string; message?: string } | null;
  const msg = `${e?.code || ''} ${e?.message || ''}`;
  return e?.code === '23505' || /duplicate key|unique constraint/i.test(msg);
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
    const row = (max as unknown as NumberRow | null);
    return ((row?.number) || 0) + 1;
  }
}

export async function getNextPurchaseInvoiceNumber(companyId: string): Promise<number> {
  const s = sb();
  try {
    const { data, error } = await s.rpc('next_purchase_invoice_number', {
      p_company_id: companyId,
    });
    if (error || data == null) throw error || new Error('RPC failed');
    return data as number;
  } catch {
    return (await maxExisting('purchase_invoices', companyId, ['invoice_number', 'number'])) + 1;
  }
}

export async function getNextPurchaseOrderNumber(companyId: string): Promise<number> {
  const s = sb();
  try {
    const { data, error } = await s.rpc('next_purchase_order_number', {
      p_company_id: companyId,
    });
    if (error || data == null) throw error || new Error('RPC failed');
    return data as number;
  } catch {
    return (await maxExisting('purchase_orders', companyId, ['po_number', 'number'])) + 1;
  }
}

export async function getNextQuotationNumber(companyId: string): Promise<number> {
  const s = sb();
  try {
    const { data, error } = await s.rpc('next_quotation_number', {
      p_company_id: companyId,
    });
    if (error || data == null) throw error || new Error('RPC failed');
    return data as number;
  } catch {
    const { data: max } = await s.from('quotations')
      .select('number').eq('company_id', companyId).order('number', { ascending: false }).limit(1).maybeSingle();
    const row = (max as unknown as NumberRow | null);
    return ((row?.number) || 0) + 1;
  }
}

type VoucherTable = 'voucher_receipts' | 'voucher_disbursements';

