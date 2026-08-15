import { NextRequest } from 'next/server';
import { success, handleApiError, requireModulePermission } from '@/lib/api-helpers';
import { getSupabase } from '@/lib/supabase-client';
import {
  detectDuplicateInvoices, detectOutliers, detectSpendingSpikes, detectInvalidValues, type AnomalyFinding,
} from '@/lib/analytics/anomaly';

/** Deterministic anomaly scan. Large datasets disclose the scan limit. */
export async function GET(request: NextRequest) {
  try {
    const auth = await requireModulePermission(request, 'reports', 'read');
    const s = getSupabase();
    const year = new Date().getUTCFullYear();
    const [invoiceResult, monthlyResult] = await Promise.all([
      s.from('invoices').select('id, contact_id, total, date', { count: 'exact' })
        .eq('company_id', auth.companyId).neq('status', 'cancelled').is('deleted_at', null)
        .order('date', { ascending: false }).range(0, 4999),
      s.rpc('get_monthly_profit_loss', { p_company_id: auth.companyId, p_year: year }),
    ]);
    if (invoiceResult.error) throw invoiceResult.error;
    if (monthlyResult.error) throw monthlyResult.error;
    const invoiceRows = (invoiceResult.data || []).map((invoice: any) => ({
      id: invoice.id, contact_id: invoice.contact_id,
      amount: Number(invoice.total), date: invoice.date,
    }));
    const findings: AnomalyFinding[] = [
      ...detectDuplicateInvoices(invoiceRows.filter((row) => Number.isFinite(row.amount)), 30),
      ...detectOutliers(invoiceRows.filter((row) => Number.isFinite(row.amount)).map((row) => ({ id: row.id, amount: row.amount }))),
      ...detectInvalidValues(invoiceRows.map((row) => ({ id: row.id, label: `فاتورة ${row.id}`, value: row.amount }))),
      ...detectSpendingSpikes((monthlyResult.data || []).map((row: any) => ({
        period: `${year}-${String(row.month_number).padStart(2, '0')}`, amount: Number(row.expenses) || 0,
      }))),
    ];
    return success({
      categories: {
        duplicate_invoices: findings.filter((finding) => finding.code === 'DUPLICATE_INVOICE'),
        outliers: findings.filter((finding) => finding.code === 'OUTLIER_AMOUNT'),
        spending_spikes: findings.filter((finding) => finding.code === 'SPENDING_SPIKE'),
        invalid_values: findings.filter((finding) => ['NEGATIVE_VALUE', 'NON_FINITE'].includes(finding.code)),
      },
      findings, total: findings.length,
      critical: findings.filter((finding) => finding.severity === 'critical').length,
      high: findings.filter((finding) => finding.severity === 'high').length,
      scannedInvoices: invoiceRows.length,
      scanTruncated: (invoiceResult.count || 0) > invoiceRows.length,
    });
  } catch (err) {
    return handleApiError(err);
  }
}
