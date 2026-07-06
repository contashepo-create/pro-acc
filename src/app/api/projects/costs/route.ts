import { NextRequest } from 'next/server';
import { success, error, unauthorized, serverError, requireApiAuth, handleApiError } from '@/lib/api-helpers';
import { query } from '@/lib/db';

export async function GET(request: NextRequest) {
  try {
    const auth = await requireApiAuth(request);
    const url = new URL(request.url);
    const projectId = url.searchParams.get('projectId');

    if (!projectId) {
      return error('رقم المشروع مطلوب');
    }

    const expensesRes = await query(
      `SELECT a.code, a.name, a.type,
              COALESCE(SUM(jl.debit), 0) AS total_debit,
              COALESCE(SUM(jl.credit), 0) AS total_credit
       FROM journal_lines jl
       JOIN accounts a ON a.id = jl.account_id
       WHERE (jl.project_id = $1 OR jl.journal_entry_id IN (
         SELECT je.id FROM journal_entries je WHERE je.project_id = $1
       ))
       AND jl.journal_entry_id IN (
         SELECT je.id FROM journal_entries je WHERE je.company_id = $2
       )
       GROUP BY a.code, a.name, a.type
       ORDER BY a.code`,
      [projectId, auth.companyId]
    );

    const revenueRes = await query(
      `SELECT COALESCE(SUM(jl.credit), 0) AS total_revenue
       FROM journal_lines jl
       JOIN accounts a ON a.id = jl.account_id
       WHERE (jl.project_id = $1 OR jl.journal_entry_id IN (
         SELECT je.id FROM journal_entries je WHERE je.project_id = $1
       ))
       AND a.type = 'revenue'
       AND jl.journal_entry_id IN (
         SELECT je.id FROM journal_entries je WHERE je.company_id = $2
       )`,
      [projectId, auth.companyId]
    );

    const grandTotalRes = await query(
      `SELECT COALESCE(SUM(jl.debit), 0) AS grand_total
       FROM journal_lines jl
       JOIN accounts a ON a.id = jl.account_id
       WHERE (jl.project_id = $1 OR jl.journal_entry_id IN (
         SELECT je.id FROM journal_entries je WHERE je.project_id = $1
       ))
       AND a.type = 'expense'
       AND jl.journal_entry_id IN (
         SELECT je.id FROM journal_entries je WHERE je.company_id = $2
       )`,
      [projectId, auth.companyId]
    );

    const categories: Record<string, { code: string; name: string; total: number; items: any[] }> = {
      materials: { code: '5110', name: 'المواد', total: 0, items: [] },
      labor: { code: '5210', name: 'العمالة', total: 0, items: [] },
      subcontractor: { code: '2150', name: 'مقاولين باطن', total: 0, items: [] },
      equipment: { code: '5200', name: 'معدات', total: 0, items: [] },
      other: { code: '5000', name: 'مصروفات أخرى', total: 0, items: [] },
    };

    for (const row of expensesRes.rows) {
      const code = row.code;
      const debit = parseFloat(row.total_debit);
      const credit = parseFloat(row.total_credit);
      const netAmount = debit - credit;

      if (netAmount === 0) continue;

      const item = {
        account_id: row.code,
        account_code: row.code,
        account_name: row.name,
        debit,
        credit,
        net: netAmount,
      };

      if (code.startsWith('511')) {
        categories.materials.total += netAmount;
        categories.materials.items.push(item);
      } else if (code.startsWith('521') || code.startsWith('522')) {
        categories.labor.total += netAmount;
        categories.labor.items.push(item);
      } else if (code.startsWith('215')) {
        categories.subcontractor.total += netAmount;
        categories.subcontractor.items.push(item);
      } else if (code.startsWith('52') && !code.startsWith('521')) {
        categories.equipment.total += netAmount;
        categories.equipment.items.push(item);
      } else if (row.type === 'expense') {
        categories.other.total += netAmount;
        categories.other.items.push(item);
      }
    }

    const grandTotal = parseFloat(grandTotalRes.rows[0].grand_total);
    const totalRevenue = parseFloat(revenueRes.rows[0].total_revenue);

    return success({
      project_id: projectId,
      categories: Object.values(categories).filter((c) => c.total > 0),
      grand_total: grandTotal,
      total_revenue: totalRevenue,
      net_profit: totalRevenue - grandTotal,
      raw_lines: expensesRes.rows,
    });
  } catch (err) {
    return handleApiError(err);
  }
}
