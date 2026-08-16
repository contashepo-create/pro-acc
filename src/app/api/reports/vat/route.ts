import { NextRequest } from 'next/server';
import { success, error, requireModulePermission, handleApiError } from '@/lib/api-helpers';
import { getSupabase } from '@/lib/supabase-client';
import { isValidDate } from '@/lib/utils';

const sb = () => getSupabase();
const number = (value: unknown) => Number(value) || 0;

/** VAT report: control accounts are authoritative; documents are reconciliation evidence. */
export async function GET(request: NextRequest) {
  try {
    const auth = await requireModulePermission(request, 'reports', 'read');
    const s = sb();
    const url = new URL(request.url);
    const from = url.searchParams.get('from') || '1900-01-01';
    const to = url.searchParams.get('to') || new Date().toISOString().slice(0, 10);
    const page = Math.max(1, Number.parseInt(url.searchParams.get('page') || '1', 10) || 1);
    const pageSize = Math.min(500, Math.max(1, Number.parseInt(url.searchParams.get('page_size') || '100', 10) || 100));
    if (!isValidDate(from) || !isValidDate(to) || from > to) return error('فترة التقرير غير صالحة');

    const [summaryResult, linesResult, invoicesResult, purchasesResult] = await Promise.all([
      s.rpc('get_vat_return_summary', { p_company_id: auth.companyId, p_from: from, p_to: to }),
      s.rpc('get_vat_ledger_lines', {
        p_company_id: auth.companyId, p_from: from, p_to: to,
        p_limit: pageSize, p_offset: (page - 1) * pageSize,
      }),
      s.from('invoices').select('id, number, date, subtotal, tax_amount:vat_amount, total', { count: 'exact' })
        .eq('company_id', auth.companyId).gte('date', from).lte('date', to)
        .neq('status', 'cancelled').is('deleted_at', null).order('date').range(0, 99),
      s.from('purchase_invoices').select('id, number, date, subtotal, tax_amount, total', { count: 'exact' })
        .eq('company_id', auth.companyId).gte('date', from).lte('date', to)
        .neq('status', 'cancelled').order('date').range(0, 99),
    ]);
    for (const result of [summaryResult, linesResult, invoicesResult, purchasesResult]) if (result.error) throw result.error;

    const summary = (summaryResult.data || {}) as Record<string, unknown>;
    const outputVat = number(summary.outputVat);
    const inputVat = number(summary.inputVat);
    const lines = linesResult.data || [];
    const salesDetails = lines.filter((row: any) => row.vat_type === 'sales').map(formatVatLine);
    const purchaseDetails = lines.filter((row: any) => row.vat_type === 'purchases').map(formatVatLine);
    const invoiceVatTotal = (invoicesResult.data || []).reduce((sum: number, row: any) => sum + number(row.tax_amount), 0);
    const purchaseVatTotal = (purchasesResult.data || []).reduce((sum: number, row: any) => sum + number(row.tax_amount), 0);
    const totalCount = lines.length ? number((lines[0] as any).total_count) : 0;

    return success({
      period: { from, to },
      vat_collected: {
        from_journal: outputVat, from_invoices_preview: invoiceVatTotal,
        total: outputVat, details: salesDetails, invoices: invoicesResult.data || [],
      },
      vat_paid: {
        from_journal: inputVat, from_invoices_preview: purchaseVatTotal,
        total: inputVat, details: purchaseDetails, purchase_invoices: purchasesResult.data || [],
      },
      summary: {
        total_sales_excluding_vat: number(summary.totalSales),
        total_sales_including_vat: number(summary.totalSales) + outputVat,
        total_purchases_excluding_vat: number(summary.totalPurchases),
        total_vat_collected: outputVat, total_vat_paid: inputVat,
        vat_payable: outputVat - inputVat,
        vat_payable_status: outputVat - inputVat >= 0 ? 'payable' : 'refundable',
      },
      pagination: { page, pageSize, total: totalCount, totalPages: Math.ceil(totalCount / pageSize) },
      reconciliationPreviewTruncated: (invoicesResult.count || 0) > 100 || (purchasesResult.count || 0) > 100,
      accountingBasis: 'posted_vat_control_accounts',
      complianceAttestation: null,
    });
  } catch (err) {
    return handleApiError(err);
  }
}

function formatVatLine(row: any) {
  return {
    date: row.entry_date, number: row.entry_number, description: row.description,
    amount: number(row.amount), type: row.vat_type,
  };
}
