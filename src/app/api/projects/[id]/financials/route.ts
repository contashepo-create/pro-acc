import { NextRequest } from 'next/server';
import { success, error, handleApiError, requireModulePermission } from '@/lib/api-helpers';
import { getSupabase } from '@/lib/supabase-client';
import { deliveryUuid } from '@/lib/project-delivery-validation';

import type { Row } from '@/lib/types';

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
    const auth = await requireModulePermission(req, 'projects', 'read');
    const { id } = await params;
    if (!deliveryUuid.safeParse(id).success) return error('معرف المشروع غير صالح');
    const s = sb();

    // Project info
    const { data: project, error: projectError } = await s.from('projects')
      .select('id, name, contract_value, status, tax_enabled, tax_rate, contacts(name)')
      .eq('id', id).eq('company_id', auth.companyId).maybeSingle();
    if (projectError) throw projectError;
    if (!project) return error('المشروع غير موجود', 404);

    const p = project as Row;
    const contractValue = parseFloat(String(p.contract_value)) || 0;

    // Invoices for this project
    const { data: invoices, error: invoicesError } = await s.from('invoices')
      .select('id, number, date, subtotal, tax_amount, total, paid_amount, status')
      .eq('project_id', id).eq('company_id', auth.companyId)
      .neq('status', 'cancelled').order('date');
    if (invoicesError) throw invoicesError;

    const invoicedNet = (invoices || []).reduce((sum: number, inv: Row) => sum + (parseFloat(String(inv.subtotal)) || 0), 0);
    const invoicedGross = (invoices || []).reduce((sum: number, inv: Row) => sum + (parseFloat(String(inv.total)) || 0), 0);
    const paidAmount = (invoices || []).reduce((sum: number, inv: Row) => sum + (parseFloat(String(inv.paid_amount)) || 0), 0);

    // Credit notes for this project
    const { data: creditNotes, error: creditNotesError } = await s.from('credit_notes')
      .select('id, number, date, total, reason')
      .eq('project_id', id).eq('company_id', auth.companyId)
      .neq('status', 'cancelled').order('date');
    if (creditNotesError) throw creditNotesError;

    const creditNoteAmount = (creditNotes || []).reduce((sum: number, cn: Row) => sum + (parseFloat(String(cn.total)) || 0), 0);

    const { sumProjectJournal } = await import('@/lib/project-costs');
    const journal = await sumProjectJournal(auth.companyId, id);

    const { data: expenses, error: expensesError } = await s.from('project_expenses')
      .select('id, expense_type, amount, date, description, tax_amount')
      .eq('project_id', id).eq('company_id', auth.companyId)
      .order('date');
    if (expensesError) throw expensesError;

    // المصدر المعتمد: قيود المشروع (تشمل فواتير العهدة والمشتريات الموسومة).
    const totalExpenses = journal.expenses;

    // Progress billing
    const { data: progressBilling, error: billingError } = await s.from('progress_billing')
      .select('id, claim_number, date, gross_amount, net_amount, tax_amount, is_final, status')
      .eq('project_id', id).eq('company_id', auth.companyId)
      .order('date');
    if (billingError) throw billingError;

    const progressTotal = (progressBilling || []).reduce((sum: number, pb: Row) => sum + (parseFloat(String(pb.gross_amount)) || 0), 0);

    // Calculations
    const netInvoiced = invoicedNet - creditNoteAmount;
    const remaining = contractValue - netInvoiced;
    const outstanding = Math.max(0, invoicedGross - paidAmount);
    // Profit must be computed on a single, consistent basis. When the ledger
    // holds any project activity, revenue and expenses both come from the
    // ledger; otherwise (no posted project journal yet) fall back to the
    // invoice-based revenue net of credit notes. Mixing invoice revenue with
    // journal expenses produced inconsistent, non-comparable profit figures.
    const hasJournalActivity = journal.revenue !== 0 || journal.expenses !== 0;
    const revenueBasis = hasJournalActivity ? journal.revenue : netInvoiced;
    const actualProfit = revenueBasis - totalExpenses;
    const profitMargin = revenueBasis > 0 ? (actualProfit / revenueBasis) * 100 : 0;
    const completionPercent = contractValue > 0 ? (netInvoiced / contractValue) * 100 : 0;

    return success({
      project: {
        id: p.id,
        name: p.name,
        client_name: p.contacts ? String((p.contacts as Row).name) || null : null,
        contract_value: contractValue,
        status: p.status,
        tax_enabled: p.tax_enabled,
        tax_rate: p.tax_rate,
      },
      summary: {
        contract_value: contractValue,
        invoiced: invoicedNet,
        credit_notes: creditNoteAmount,
        net_invoiced: netInvoiced,
        paid: paidAmount,
        outstanding: outstanding,
        remaining_contract: remaining,
        expenses: totalExpenses,
        journal_revenue: journal.revenue,
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
