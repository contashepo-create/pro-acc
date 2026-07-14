import { NextRequest } from 'next/server';
import { success, error, notFound, handleApiError } from '@/lib/api-helpers';
import type { } from '@/lib/api-helpers';
import { getSupabase } from '@/lib/supabase-client';

const sb = () => getSupabase();

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { requireApiAuth, requireManagerOrAbove } = await import('@/lib/api-helpers');
    const ctx = await requireApiAuth(request);
    const { id } = await params;
    const s = sb();

    const { data: voucher } = await s.from('voucher_disbursements')
      .select('*, contacts!contact_id(name), banks_safes!bank_safe_id(name), journal_entries!journal_entry_id(sequence_number), employees!employee_id(name)')
      .eq('id', id)
      .eq('company_id', ctx.companyId)
      .maybeSingle();

    if (!voucher) return notFound();

    return success({
      ...voucher,
      contact_name: (voucher as Record<string, any>).contacts?.name || null,
      bank_safe_name: (voucher as Record<string, any>).banks_safes?.name || null,
      journal_entry_number: (voucher as Record<string, any>).journal_entries?.sequence_number || null,
      employee_name: (voucher as Record<string, any>).employees?.name || null,
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
    const { requireApiAuth, requireManagerOrAbove } = await import('@/lib/api-helpers');
    const ctx = await requireManagerOrAbove(request);
    const { id } = await params;
    const s = sb();

    const { data: voucher } = await s.from('voucher_disbursements')
      .select('*')
      .eq('id', id)
      .eq('company_id', ctx.companyId)
      .maybeSingle();

    if (!voucher) return notFound();

    const { data: depRes } = await s.from('cash_transactions')
      .select('id')
      .eq('voucher_disbursement_id', id)
      .limit(1);

    if (depRes && depRes.length > 0) {
      return error('لا يمكن حذف سند الصرف لأنه مرتبط بحركات نقدية');
    }

    // Sequential deletes (was a transaction)
    if ((voucher as Record<string, any>).disbursement_type === 'employee_advance' && (voucher as Record<string, any>).employee_id) {
      await s.from('employee_advances')
        .delete()
        .eq('journal_entry_id', (voucher as Record<string, any>).journal_entry_id);
    }

    if ((voucher as Record<string, any>).journal_entry_id) {
      await s.from('journal_lines')
        .delete()
        .eq('journal_entry_id', (voucher as Record<string, any>).journal_entry_id);
      await s.from('journal_entries')
        .delete()
        .eq('id', (voucher as Record<string, any>).journal_entry_id);
    }

    await s.from('voucher_disbursements').delete().eq('id', id);

    return success({ deleted: true });
  } catch (err) {
    return handleApiError(err);
  }
}
