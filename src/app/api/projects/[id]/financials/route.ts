import { NextRequest } from 'next/server';
import { success, error, requireApiAuth, handleApiError } from '@/lib/api-helpers';
import { getSupabase } from '@/lib/supabase-client';

const sb = () => getSupabase();

/**
 * GET /api/projects/[id]/financials
 * ملخص مالي شامل للمشروع:
 * - قيمة العقد
 * - المُفوتر (فواتير)
 * - الإشعارات الدائنة
 * - الدفعات المقدمة
 * - المصروفات
 * - المتبقي من العقد
 */
export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const auth = await requireApiAuth(req);
    const { id } = await params;
    const s = sb();

    // Project info
    const { data: project } = await s.from('projects')
      .select('id, name, contract_value, status, tax_enabled, tax_rate, contacts(name)')
      .eq('id', id).eq('company_id', auth.companyId).maybeSingle();
    if (!project) return error('المشروع غير موجود', 404);

    const p = project as any;
    const contractValue = parseFloat(p.contract_value) || 0;

    // Invoices for this project
    const { data: invoices } = await s.from('invoices')
      .select('id, number, date, subtotal, tax_amount, total, paid_amount, status')
      .eq('project_id', id).eq('company_id', auth.companyId)
      .neq('status', 'cancelled').order('date');

    const invoicedAmount = (invoices || []).reduce((sum: number, inv: any) => sum + (parseFloat(inv.total) || 0), 0);
    const paidAmount = (invoices || []).reduce((sum: number, inv: any) => sum + (parseFloat(inv.paid_amount) || 0), 0);

    // Credit notes for this project
    const { data: creditNotes } = await s.from('credit_notes')
      .select('id, number, date, total, reason')
      .eq('project_id', id).eq('company_id', auth.companyId)
      .neq('status', 'cancelled').order('date');

    const creditNoteAmount = (creditNotes || []).reduce((sum: number, cn: any) => sum + (parseFloat(cn.total) || 0), 0);

    // Client advances for this project (via voucher receipts linked to project invoices)
    const { data: advances } = await s.from('client_advances')
      .select('id, amount, date, status')
      .eq('company_id', auth.companyId)
      .order('date');

    // Project expenses
    const { data: expenses } = await s.from('project_expenses')
      .select('id, expense_type, amount, date, description, tax_amount')
      .eq('project_id', id).eq('company_id', auth.companyId)
      .order('date');

    const totalExpenses = (expenses || []).reduce((sum: number, e: any) => sum + (parseFloat(e.amount) || 0), 0);

    // Progress billing
    const { data: progressBilling } = await s.from('progress_billing')
      .select('id, claim_number, date, gross_amount, net_amount, tax_amount, is_final, status')
      .eq('project_id', id).eq('company_id', auth.companyId)
      .order('date');

    const progressTotal = (progressBilling || []).reduce((sum: number, pb: any) => sum + (parseFloat(pb.gross_amount) || 0), 0);

    // Calculations
    const netInvoiced = invoicedAmount - creditNoteAmount;
    const remaining = contractValue - netInvoiced;
    const outstanding = invoicedAmount - paidAmount - creditNoteAmount;
    const actualProfit = netInvoiced - totalExpenses;
    const profitMargin = netInvoiced > 0 ? (actualProfit / netInvoiced) * 100 : 0;
    const completionPercent = contractValue > 0 ? (netInvoiced / contractValue) * 100 : 0;

    return success({
      project: {
        id: p.id,
        name: p.name,
        client_name: p.contacts?.name || null,
        contract_value: contractValue,
        status: p.status,
        tax_enabled: p.tax_enabled,
        tax_rate: p.tax_rate,
      },
      summary: {
        contract_value: contractValue,
        invoiced: invoicedAmount,
        credit_notes: creditNoteAmount,
        net_invoiced: netInvoiced,
        paid: paidAmount,
        outstanding: outstanding,
        remaining_contract: remaining,
        expenses: totalExpenses,
        progress_billing: progressTotal,
        actual_profit: actualProfit,
        profit_margin: profitMargin,
        completion_percent: completionPercent,
      },
      invoices: invoices || [],
      credit_notes: creditNotes || [],
      expenses: expenses || [],
      progress_billing: progressBilling || [],
    });
  } catch (err) {
    return handleApiError(err);
  }
}
