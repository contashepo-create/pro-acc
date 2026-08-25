import { NextRequest } from 'next/server';
import { success, error, requireModulePermission, handleApiError } from '@/lib/api-helpers';
import { getSupabase } from '@/lib/supabase-client';

const sb = () => getSupabase();
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

/** GET /api/banks/[id]/statement — full ledger movement statement for one safe/bank.
 *  Source of truth: journal lines on the safe's GL account, so every posting
 *  path (vouchers, cash, custodies, invoices) appears exactly once. */
export async function GET(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const auth = await requireModulePermission(request, 'banks', 'read');
    const { id } = await params;
    if (!UUID.test(id)) return error('معرّف الخزينة/البنك غير صالح', 400);
    const s = sb();
    const url = new URL(request.url);
    const from = url.searchParams.get('from');
    const to = url.searchParams.get('to');
    const dateOnly = /^\d{4}-\d{2}-\d{2}$/;
    if ((from && !dateOnly.test(from)) || (to && !dateOnly.test(to))) return error('نطاق التاريخ غير صالح');

    const { data: safe, error: safeErr } = await s.from('banks_safes')
      .select('id,name,type,account_id').eq('id', id).eq('company_id', auth.companyId).maybeSingle();
    if (safeErr) throw safeErr;
    if (!safe || !(safe as Record<string, unknown>).account_id) return error('الخزينة/البنك غير موجود أو بلا حساب مرتبط', 404);

    let q = s.from('journal_lines').select(`
        debit, credit, description,
        journal_entries!inner(id,number,date,status,reference_type)
      `)
      .eq('company_id', auth.companyId)
      .eq('account_id', (safe as Record<string, unknown>).account_id as string)
      .eq('journal_entries.status', 'posted');
    if (from) q = q.gte('journal_entries.date', from);
    if (to) q = q.lte('journal_entries.date', to);

    const { data, error: qErr } = await q.order('date', { referencedTable: 'journal_entries' }).limit(5000);
    if (qErr) throw qErr;

    let balance = 0; let totalDebit = 0; let totalCredit = 0;
    const rows = (data || []).map((line: Record<string, unknown>, i: number) => {
      const je = line.journal_entries as Record<string, unknown> | null;
      const debit = Number(line.debit) || 0;
      const credit = Number(line.credit) || 0;
      balance += debit - credit; totalDebit += debit; totalCredit += credit;
      return {
        seq: i + 1,
        date: String(je?.date ?? ''),
        number: String(je?.number ?? ''),
        reference_type: String(je?.reference_type ?? ''),
        description: String(line.description ?? je?.reference_type ?? ''),
        debit, credit, balance: Math.round(balance * 100) / 100,
      };
    });

    return success({ safe, rows, totals: { debit: totalDebit, credit: totalCredit, balance } });
  } catch (err) {
    return handleApiError(err);
  }
}
