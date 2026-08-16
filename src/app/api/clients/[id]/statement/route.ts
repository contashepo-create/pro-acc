import { NextRequest } from 'next/server';
import { success, error, handleApiError, requireModulePermission } from '@/lib/api-helpers';
import { getSupabase } from '@/lib/supabase-client';
import { isValidDate } from '@/lib/utils';

const sb = () => getSupabase();
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const number = (value: unknown) => Number(value) || 0;

/** GET /api/clients/[id]/statement?from=&to=&page=&pageSize= */
export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const auth = await requireModulePermission(req, 'clients', 'read');
    const { id } = await params;
    if (!UUID_RE.test(id)) return error('معرّف العميل غير صالح');
    const s = sb();
    const url = new URL(req.url);
    const from = url.searchParams.get('from');
    const to = url.searchParams.get('to');
    const page = Math.max(1, Number.parseInt(url.searchParams.get('page') || '1', 10) || 1);
    const pageSize = Math.min(500, Math.max(1, Number.parseInt(url.searchParams.get('pageSize') || '500', 10) || 500));
    if ((from && !isValidDate(from)) || (to && !isValidDate(to)) || (from && to && from > to)) {
      return error('فترة كشف الحساب غير صالحة');
    }

    const { data: client, error: clientError } = await s.from('contacts')
      .select('id, name, type, phone, email, address, tax_number, commercial_registration')
      .eq('id', id).eq('company_id', auth.companyId).in('type', ['client', 'both']).maybeSingle();
    if (clientError) throw clientError;
    if (!client) return error('العميل غير موجود', 404);

    const offset = (page - 1) * pageSize;
    const [summaryResult, linesResult, invoicesResult, receiptsResult] = await Promise.all([
      s.rpc('get_contact_statement_summary', {
        p_company_id: auth.companyId, p_contact_id: id, p_from: from, p_to: to,
      }),
      s.rpc('get_contact_statement_lines', {
        p_company_id: auth.companyId, p_contact_id: id, p_from: from, p_to: to,
        p_limit: pageSize, p_offset: offset,
      }),
      (() => {
        let query = s.from('invoices').select('id, number, date, total, paid_amount, status', { count: 'exact' })
          .eq('contact_id', id).eq('company_id', auth.companyId);
        if (from) query = query.gte('date', from);
        if (to) query = query.lte('date', to);
        return query.order('date', { ascending: true }).range(0, 499);
      })(),
      (() => {
        let query = s.from('voucher_receipts').select('id, number, date, amount, status, reason', { count: 'exact' })
          .eq('contact_id', id).eq('company_id', auth.companyId);
        if (from) query = query.gte('date', from);
        if (to) query = query.lte('date', to);
        return query.order('date', { ascending: true }).range(0, 499);
      })(),
    ]);
    for (const result of [summaryResult, linesResult, invoicesResult, receiptsResult]) if (result.error) throw result.error;

    const summary = (summaryResult.data || {}) as Record<string, unknown>;
    const entries = (linesResult.data || []).map((line: Record<string, unknown>) => {
      const debit = number(line.debit);
      const credit = number(line.credit);
      return {
        id: line.line_id,
        date: line.entry_date,
        entry_number: line.entry_number,
        type: line.reference_type || line.entry_type || 'journal',
        reference_id: line.reference_id || null,
        description: line.description || '',
        debit,
        credit,
        balance: number(line.running_balance),
        entry_id: line.entry_id,
        created_by: line.created_by || null,
        created_by_name: line.created_by_name || null,
      };
    });
    const totalCount = number(summary.total_count);

    return success({
      client,
      period: { from, to },
      opening_balance: number(summary.opening_balance),
      entries,
      total_debit: number(summary.period_debit),
      total_credit: number(summary.period_credit),
      balance: number(summary.closing_balance),
      invoices: invoicesResult.data || [],
      receipts: receiptsResult.data || [],
      supportingDocumentsTruncated: (invoicesResult.count || 0) > 500 || (receiptsResult.count || 0) > 500,
      pagination: { page, pageSize, total: totalCount, totalPages: Math.ceil(totalCount / pageSize) },
      accountingBasis: 'posted_contact_control_accounts',
    });
  } catch (err) {
    return handleApiError(err);
  }
}
