import { NextRequest } from 'next/server';
import { success, requireApiAuth, handleApiError, requireModulePermission } from '@/lib/api-helpers';
import { getSupabase } from '@/lib/supabase-client';
import {
  detectDuplicateInvoices,
  detectOutliers,
  detectSpendingSpikes,
  detectInvalidValues,
  type AnomalyFinding,
} from '@/lib/analytics/anomaly';

const sb = () => getSupabase();

/**
 * GET /api/reports/anomalies — run heuristic anomaly detectors over the
 * company's financial data and return findings grouped by category.
 */
export async function GET(request: NextRequest) {
  try {
    const auth = await requireModulePermission(request, 'reports', 'read');
    const s = sb();

    // Invoices for duplicate + outlier detection.
    const { data: invoices } = await s.from('invoices')
      .select('id, contact_id, total, date')
      .eq('company_id', auth.companyId);
    const invoiceRows = (invoices || []).map((inv: any) => ({
      id: inv.id, contact_id: inv.contact_id, amount: parseFloat(String(inv.total)) || 0, date: inv.date,
    }));

    // NOTE: spending_spike detector is available in lib/analytics/anomaly and
    // can be wired to a monthly expense series here when such a series exists.

    const findings: AnomalyFinding[] = [
      ...detectDuplicateInvoices(invoiceRows, 30),
      ...detectOutliers(invoiceRows.map((i: any) => ({ id: i.id, amount: i.amount }))),
    ];

    return success({
      categories: {
        duplicate_invoices: findings.filter((f) => f.code === 'DUPLICATE_INVOICE'),
        outliers: findings.filter((f) => f.code === 'OUTLIER_AMOUNT'),
        spending_spikes: findings.filter((f) => f.code === 'SPENDING_SPIKE'),
        invalid_values: findings.filter((f) => f.code === 'NEGATIVE_VALUE' || f.code === 'NON_FINITE'),
      },
      findings,
      total: findings.length,
      critical: findings.filter((f) => f.severity === 'critical').length,
      high: findings.filter((f) => f.severity === 'high').length,
    });
  } catch (err) {
    return handleApiError(err);
  }
}
