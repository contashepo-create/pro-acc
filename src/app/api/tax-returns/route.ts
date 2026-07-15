import { NextRequest } from 'next/server';
import { success, error, requireApiAuth, handleApiError } from '@/lib/api-helpers';
import { getSupabase } from '@/lib/supabase-client';
import { generateId } from '@/lib/utils';

const sb = () => getSupabase();

/**
 * GET /api/tax-returns — Generate VAT return for a period
 * Calculates output VAT (sales), input VAT (purchases), and net amount due
 */
export async function GET(request: NextRequest) {
  try {
    const auth = await requireApiAuth(request);
    const s = sb();
    const url = new URL(request.url);

    const periodFrom = url.searchParams.get('from');
    const periodTo = url.searchParams.get('to');

    if (!periodFrom || !periodTo) {
      return error('تاريخ بداية ونهاية الفترة مطلوبان (from, to)');
    }

    // 1. Output VAT (Sales VAT) — from invoices issued in the period
    const { data: salesInvoices } = await s.from('invoices')
      .select('id, number, date, total, vat_amount, status')
      .eq('company_id', auth.companyId)
      .gte('date', periodFrom)
      .lte('date', periodTo)
      .in('status', ['paid', 'partial']);

    const outputVAT = (salesInvoices || []).reduce(
      (sum: number, inv: any) => sum + (parseFloat(inv.vat_amount) || 0), 0
    );
    const totalSales = (salesInvoices || []).reduce(
      (sum: number, inv: any) => sum + (parseFloat(inv.total) || 0), 0
    );

    // 2. Input VAT (Purchase VAT) — from purchase invoices in the period
    const { data: purchaseInvoices } = await s.from('purchase_invoices')
      .select('id, invoice_number, date, total, vat_amount, status')
      .eq('company_id', auth.companyId)
      .gte('date', periodFrom)
      .lte('date', periodTo)
      .in('status', ['paid', 'partial']);

    const inputVAT = (purchaseInvoices || []).reduce(
      (sum: number, inv: any) => sum + (parseFloat(inv.vat_amount) || 0), 0
    );
    const totalPurchases = (purchaseInvoices || []).reduce(
      (sum: number, inv: any) => sum + (parseFloat(inv.total) || 0), 0
    );

    // 3. Zero-rated and exempt sales
    const { data: exemptSales } = await s.from('invoices')
      .select('id, number, total, vat_amount')
      .eq('company_id', auth.companyId)
      .gte('date', periodFrom)
      .lte('date', periodTo)
      .eq('vat_rate', 0);

    const zeroRatedSales = (exemptSales || []).reduce(
      (sum: number, inv: any) => sum + (parseFloat(inv.total) || 0), 0
    );

    // 4. Calculate net VAT
    const netVAT = outputVAT - inputVAT;
    const isPayable = netVAT > 0;

    // 5. Previous period comparison (if exists)
    const periodDays = (new Date(periodTo).getTime() - new Date(periodFrom).getTime()) / 86400000;
    const prevFrom = new Date(new Date(periodFrom).getTime() - periodDays * 86400000).toISOString().split('T')[0];
    const prevTo = periodFrom;

    const { data: prevInvoices } = await s.from('invoices')
      .select('total, vat_amount')
      .eq('company_id', auth.companyId)
      .gte('date', prevFrom)
      .lt('date', prevTo)
      .in('status', ['paid', 'partial']);

    const prevOutputVAT = (prevInvoices || []).reduce(
      (sum: number, inv: any) => sum + (parseFloat(inv.vat_amount) || 0), 0
    );
    const prevNetVAT = prevOutputVAT; // simplified

    // 6. Build ZATCA return form
    const vatReturn = {
      // Part 1: Sales
      standardRatedSalesInSAR: totalSales - zeroRatedSales,
      standardRatedVAT: outputVAT,
      zeroRatedSales: zeroRatedSales,

      // Part 2: Purchases
      standardRatedPurchasesInSAR: totalPurchases,
      standardRatedPurchaseVAT: inputVAT,

      // Part 3: Adjustments
      adjustments: 0, // Manual adjustments

      // Part 4: Net VAT
      totalVATDue: outputVAT,
      totalVATRecoverable: inputVAT,
      netVATDue: netVAT,
      isPayable,

      // Meta
      period: { from: periodFrom, to: periodTo },
      invoiceCount: (salesInvoices || []).length,
      purchaseCount: (purchaseInvoices || []).length,
      generatedAt: new Date().toISOString(),

      // Comparison
      previousPeriod: {
        netVAT: prevNetVAT,
        change: prevNetVAT > 0 ? netVAT - prevNetVAT : 0,
        changePercent: prevNetVAT > 0 ? ((netVAT - prevNetVAT) / prevNetVAT * 100).toFixed(1) : null,
      },
    };

    // 7. Deadline calculation (end of month following the quarter)
    const periodEndDate = new Date(periodTo);
    const quarter = Math.ceil((periodEndDate.getMonth() + 1) / 3);
    const deadlineMonth = quarter * 3; // 3, 6, 9, 12
    const deadline = new Date(periodEndDate.getFullYear(), deadlineMonth, 0); // Last day of the quarter month
    deadline.setDate(deadline.getDate() + 28); // Usually 28 days after quarter end

    return success({
      vatReturn,
      filingDeadline: deadline.toISOString().split('T')[0],
      salesDetails: salesInvoices || [],
      purchaseDetails: purchaseInvoices || [],
    });
  } catch (err) {
    return handleApiError(err);
  }
}

/**
 * POST /api/tax-returns — Save a VAT return filing record
 */
export async function POST(request: NextRequest) {
  try {
    const auth = await requireApiAuth(request);
    const s = sb();
    const body = await request.json();

    if (!body.period_from || !body.period_to || body.net_vat === undefined) {
      return error('الفترة وصافي الضريبة مطلوبان');
    }

    const filingId = generateId();
    const { data, error: insertErr } = await s.from('vat_return_filings')
      .insert({
        id: filingId,
        company_id: auth.companyId,
        period_from: body.period_from,
        period_to: body.period_to,
        output_vat: body.output_vat || 0,
        input_vat: body.input_vat || 0,
        net_vat: body.net_vat,
        total_sales: body.total_sales || 0,
        total_purchases: body.total_purchases || 0,
        status: body.status || 'draft', // draft, filed, paid
        filed_at: body.status === 'filed' ? new Date().toISOString() : null,
        filed_by: body.status === 'filed' ? auth.userId : null,
        notes: body.notes || null,
        created_by: auth.userId,
        created_at: new Date().toISOString(),
      })
      .select()
      .single();

    if (insertErr) throw insertErr;
    return success(data, 201);
  } catch (err) {
    return handleApiError(err);
  }
}
