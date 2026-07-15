import { NextRequest } from 'next/server';
import { success, error, requireApiAuth, handleApiError } from '@/lib/api-helpers';
import { getSupabase } from '@/lib/supabase-client';
import { generateId } from '@/lib/utils';

const sb = () => getSupabase();

/**
 * GET /api/budgets — List budgets with actual comparison
 */
export async function GET(request: NextRequest) {
  try {
    const auth = await requireApiAuth(request);
    const s = sb();
    const url = new URL(request.url);
    const projectId = url.searchParams.get('project_id');

    let query = s.from('project_budgets')
      .select('*, projects(name)')
      .eq('company_id', auth.companyId);

    if (projectId) query = query.eq('project_id', projectId);

    const { data, error: qErr } = await query.order('created_at', { ascending: false });
    if (qErr) throw qErr;

    const budgets = await Promise.all((data || []).map(async (b: any) => {
      // Calculate actual spending for this budget category
      const actual = await getActualSpending(s, auth.companyId, b.project_id, b.category);
      const variance = (parseFloat(b.amount) || 0) - actual;
      const variancePercent = (parseFloat(b.amount) || 0) > 0
        ? (variance / parseFloat(b.amount)) * 100 : 0;

      return {
        ...b,
        project_name: b.projects?.name || null,
        actual_spent: actual,
        variance,
        variance_percent: variancePercent,
        is_over_budget: variance < 0,
      };
    }));

    // Summary
    const totalBudget = budgets.reduce((s: number, b: any) => s + (parseFloat(b.amount) || 0), 0);
    const totalActual = budgets.reduce((s: number, b: any) => s + b.actual_spent, 0);

    return success({
      budgets,
      summary: {
        totalBudget,
        totalActual,
        totalVariance: totalBudget - totalActual,
        utilizationPercent: totalBudget > 0 ? (totalActual / totalBudget) * 100 : 0,
      },
    });
  } catch (err) {
    return handleApiError(err);
  }
}

/**
 * POST /api/budgets — Create budget entry
 */
export async function POST(request: NextRequest) {
  try {
    const auth = await requireApiAuth(request);
    const s = sb();
    const body = await request.json();

    if (!body.project_id || !body.category || !body.amount) {
      return error('المشروع والفئة والمبلغ مطلوبة');
    }

    const budgetId = generateId();
    const { data, error: insertErr } = await s.from('project_budgets')
      .insert({
        id: budgetId,
        company_id: auth.companyId,
        project_id: body.project_id,
        category: body.category, // materials, labor, equipment, subcontractor, overhead
        subcategory: body.subcategory || null,
        amount: body.amount,
        period: body.period || 'total', // total, monthly, quarterly
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

async function getActualSpending(s: any, companyId: string, projectId: string, category: string): Promise<number> {
  try {
    // Map budget category to account codes
    const categoryAccounts: Record<string, string[]> = {
      materials: ['5100', '5110', '5120'],
      labor: ['5200', '5210', '5220'],
      equipment: ['5300', '5310'],
      subcontractor: ['5400', '5410'],
      overhead: ['5500', '5510', '5520'],
    };

    const accountCodes = categoryAccounts[category] || [];
    if (accountCodes.length === 0) return 0;

    // Get account IDs
    const { data: accounts } = await s.from('accounts')
      .select('id')
      .eq('company_id', companyId)
      .in('code', accountCodes);

    if (!accounts || accounts.length === 0) return 0;
    const accountIds = accounts.map((a: any) => a.id);

    // Get actual spending from journal lines linked to this project
    const { data: lines } = await s.from('journal_lines')
      .select('debit')
      .eq('project_id', projectId)
      .in('account_id', accountIds);

    return (lines || []).reduce((sum: number, l: any) => sum + (parseFloat(l.debit) || 0), 0);
  } catch {
    return 0;
  }
}
