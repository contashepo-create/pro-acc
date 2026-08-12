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
    // Fallback: old logic using sequence table
    const { data: seq } = await s.from('invoice_sequences')
      .select('last_number').eq('company_id', companyId).eq('year', year).maybeSingle();
    if (seq) {
      const row = seq as unknown as SequenceRow;
      const next = row.last_number + 1;
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
    const { data: max } = await s.from('purchase_invoices')
      .select('invoice_number').eq('company_id', companyId).order('invoice_number', { ascending: false }).limit(1).maybeSingle();
    const row = (max as unknown as InvoiceNumberRow | null);
    return ((row?.invoice_number) || 0) + 1;
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
    const { data: max } = await s.from('purchase_orders')
      .select('po_number').eq('company_id', companyId).order('po_number', { ascending: false }).limit(1).maybeSingle();
    const row = (max as unknown as PONumberRow | null);
    return ((row?.po_number) || 0) + 1;
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

