import { NextRequest } from 'next/server';
import { success, error, unauthorized, serverError, notFound, handleApiError } from '@/lib/api-helpers';
import { getSupabase } from '@/lib/supabase-client';

// @ts-ignore
const sb = () => getSupabase() as any;

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { requireApiAuth } = await import('@/lib/api-helpers');
    const ctx = await requireApiAuth(request);
    const { id } = await params;
    const s = sb();

    const { data: voucher } = await s.from('voucher_receipts')
      .select('*, contacts!contact_id(name), banks_safes!bank_safe_id(name), journal_entries!journal_entry_id(sequence_number)')
      .eq('id', id)
      .eq('company_id', ctx.companyId)
      .maybeSingle();

    if (!voucher) return notFound();

    const { data: invoiceItems } = await s.from('receipt_invoice_items')
      .select('*, invoices!invoice_id(number)')
      .eq('voucher_receipt_id', id);

    return success({
      ...voucher,
      contact_name: (voucher as any).contacts?.name || null,
      bank_safe_name: (voucher as any).banks_safes?.name || null,
      journal_entry_number: (voucher as any).journal_entries?.sequence_number || null,
      invoice_items: (invoiceItems || []).map((ri: any) => ({
        ...ri,
        invoice_number: ri.invoices?.number || null,
      })),
    });
  } catch (err) {
    return handleApiError(err);
  }
}

export async function DELETE(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { requireApiAuth } = await import('@/lib/api-helpers');
    const ctx = await requireApiAuth(request);
    const { id } = await params;
    const s = sb();

    const { data: voucher } = await s.from('voucher_receipts')
      .select('*')
      .eq('id', id)
      .eq('company_id', ctx.companyId)
      .maybeSingle();

    if (!voucher) return notFound();

    const { data: depRes } = await s.from('cash_transactions')
      .select('id')
      .eq('voucher_receipt_id', id)
      .limit(1);

    if (depRes && depRes.length > 0) {
      return error('لا يمكن حذف سند القبض لأنه مرتبط بحركات نقدية');
    }

    await s.from('receipt_invoice_items').delete().eq('voucher_receipt_id', id);

    if ((voucher as any).journal_entry_id) {
      await s.from('journal_lines')
        .delete()
        .eq('journal_entry_id', (voucher as any).journal_entry_id);
      await s.from('journal_entries')
        .delete()
        .eq('id', (voucher as any).journal_entry_id);
    }

    await s.from('voucher_receipts').delete().eq('id', id);

    return success({ deleted: true });
  } catch (err) {
    return handleApiError(err);
  }
}
