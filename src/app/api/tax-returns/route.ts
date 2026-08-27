import type { Row } from '@/lib/types';
import { NextRequest } from 'next/server';
import { success, error, parseBody, handleApiError, requireModulePermission } from '@/lib/api-helpers';
import { getSupabase } from '@/lib/supabase-client';
import { isValidDate } from '@/lib/utils';

const sb = () => getSupabase();
const number = (value: unknown) => Number(value) || 0;

function validPeriod(from: unknown, to: unknown): from is string {
  return typeof from === 'string' && typeof to === 'string'
    && isValidDate(from) && isValidDate(to) && from <= to;
}

async function loadSummary(companyId: string, from: string, to: string) {
  const { data, error: queryError } = await sb().rpc('get_vat_return_summary', {
    p_company_id: companyId, p_from: from, p_to: to,
  });
  if (queryError) throw queryError;
  return (data || {}) as Record<string, unknown>;
}

/** Generate a VAT return from posted VAT control-account movements. */
export async function GET(request: NextRequest) {
  try {
    const auth = await requireModulePermission(request, 'tax_returns', 'read');
    const s = sb();
    const url = new URL(request.url);
    const periodFrom = url.searchParams.get('from');
    const periodTo = url.searchParams.get('to');
    if (!validPeriod(periodFrom, periodTo)) return error('فترة الضريبة غير صالحة');

    const fromTime = Date.parse(`${periodFrom}T00:00:00Z`);
    const toTime = Date.parse(`${periodTo}T00:00:00Z`);
    const inclusiveDays = Math.floor((toTime - fromTime) / 86400000) + 1;
    const previousToDate = new Date(fromTime - 86400000);
    const previousFromDate = new Date(fromTime - inclusiveDays * 86400000);
    const previousFrom = previousFromDate.toISOString().slice(0, 10);
    const previousTo = previousToDate.toISOString().slice(0, 10);

    const [summary, previous, salesResult, purchasesResult] = await Promise.all([
      loadSummary(auth.companyId, periodFrom!, periodTo!),
      loadSummary(auth.companyId, previousFrom, previousTo),
      s.from('invoices').select('id, number, date, subtotal, vat_amount, total, status', { count: 'exact' })
        .eq('company_id', auth.companyId).gte('date', periodFrom || '').lte('date', periodTo || '')
        .neq('status', 'cancelled').is('deleted_at', null).order('date').range(0, 499),
      s.from('purchase_invoices').select('id, number, date, subtotal, tax_amount, total, status', { count: 'exact' })
        .eq('company_id', auth.companyId).gte('date', periodFrom!).lte('date', periodTo!)
        .neq('status', 'cancelled').order('date').range(0, 499),
    ]);
    if (salesResult.error) throw salesResult.error;
    if (purchasesResult.error) throw purchasesResult.error;

    const outputVAT = number(summary.outputVat);
    const inputVAT = number(summary.inputVat);
    const totalSales = number(summary.totalSales);
    const totalPurchases = number(summary.totalPurchases);
    const zeroRatedSales = number(summary.zeroRatedSales);
    const netVAT = outputVAT - inputVAT;
    const previousNetVAT = number(previous.outputVat) - number(previous.inputVat);
    const periodEnd = new Date(`${periodTo}T00:00:00Z`);
    // Saudi VAT returns are due by the last day of the month following the
    // filing period, whether the taxpayer files monthly or quarterly.
    const deadline = new Date(Date.UTC(periodEnd.getUTCFullYear(), periodEnd.getUTCMonth() + 2, 0));

    return success({
      vatReturn: {
        standardRatedSalesInSAR: Math.max(0, totalSales - zeroRatedSales),
        standardRatedVAT: outputVAT,
        zeroRatedSales,
        standardRatedPurchasesInSAR: totalPurchases,
        standardRatedPurchaseVAT: inputVAT,
        adjustments: 0,
        totalVATDue: outputVAT,
        totalVATRecoverable: inputVAT,
        netVATDue: netVAT,
        isPayable: netVAT > 0,
        period: { from: periodFrom, to: periodTo },
        invoiceCount: number(summary.invoiceCount),
        purchaseCount: number(summary.purchaseCount),
        generatedAt: new Date().toISOString(),
        previousPeriod: {
          from: previousFrom, to: previousTo, netVAT: previousNetVAT,
          change: netVAT - previousNetVAT,
          changePercent: previousNetVAT !== 0 ? (((netVAT - previousNetVAT) / Math.abs(previousNetVAT)) * 100).toFixed(1) : null,
        },
      },
      filingDeadline: deadline.toISOString().slice(0, 10),
      salesDetails: salesResult.data || [],
      purchaseDetails: purchasesResult.data || [],
      detailsTruncated: (salesResult.count || 0) > 500 || (purchasesResult.count || 0) > 500,
    });
  } catch (err) {
    return handleApiError(err);
  }
}

/** Save an immutable server-calculated VAT filing snapshot. */
export async function POST(request: NextRequest) {
  try {
    const auth = await requireModulePermission(request, 'tax_returns', 'create');
    const body = await parseBody<Row>(request);
    if (!validPeriod(String(body.period_from), String(body.period_to))) return error('فترة الضريبة غير صالحة');
    if (body.status && !['draft', 'filed'].includes(String(body.status))) return error('حالة الإقرار غير صالحة');
    if (body.notes !== undefined && (typeof body.notes !== 'string' || body.notes.length > 2000)) return error('الملاحظات طويلة جداً');
    const status = body.status || 'draft';
    const fromTime = Date.parse(`${body.period_from}T00:00:00Z`);
    const toTime = Date.parse(`${body.period_to}T00:00:00Z`);
    const today = new Date().toISOString().slice(0, 10);
    if (String(body.period_to) > today || Math.floor((toTime - fromTime) / 86400000) > 365) {
      return error('فترة الإقرار يجب ألا تتجاوز 366 يوماً أو تنتهي في المستقبل');
    }
    if (status === 'filed' && auth.role !== 'admin') {
      const { hasModulePermission } = await import('@/lib/permissions');
      if (!await hasModulePermission(auth.userId, auth.companyId, 'tax_returns', 'approve')) {
        return error('ليس لديك صلاحية اعتماد الإقرار الضريبي', 403);
      }
    }

    const { data, error: filingError } = await sb().rpc('create_vat_return_filing_atomic', {
      p_company_id: auth.companyId,
      p_period_from: body.period_from,
      p_period_to: body.period_to,
      p_status: status,
      p_notes: body.notes?.trim() || '',
      p_user_id: auth.userId,
    });
    if (filingError?.code === '23505') return error('يوجد إقرار محفوظ لهذه الفترة بالفعل', 409);
    if (filingError && /overlapping vat filing period/i.test(filingError.message || '')) {
      return error('تتداخل الفترة مع إقرار ضريبي معتمد أو مقدم', 409);
    }
    if (filingError) throw filingError;
    return success(data, 201);
  } catch (err) {
    return handleApiError(err);
  }
}
