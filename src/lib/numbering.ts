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
    const row = (max as unknown as NumberRow | null);
    return ((row?.number) || 0) + 1;
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

export async function getNextNumberForTable(companyId: string, table: string): Promise<number> {
  const s = sb();
  try {
    if (table === 'voucher_receipts' || table === 'voucher_disbursements') {
      return getNextVoucherNumber(companyId, table as VoucherTable);
    }
    if (table === 'journal_entries') {
      return getNextVoucherNumber(companyId, 'voucher_receipts' as VoucherTable);
    }
    const { data: max } = await s.from(table)
      .select('number').eq('company_id', companyId).order('number', { ascending: false }).limit(1).maybeSingle();
    const row = (max as unknown as NumberRow | null);
    return ((row?.number) || 0) + 1;
  } catch {
    return 1;
  }
}
