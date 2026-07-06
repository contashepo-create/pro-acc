import { NextRequest } from 'next/server';
import { success, error, serverError, requireApiAuth, handleApiError } from '@/lib/api-helpers';
import { query } from '@/lib/db';

export async function GET(req: NextRequest) {
  try {
    const auth = await requireApiAuth(req);
    const url = new URL(req.url);

    const projects = await query(
      `SELECT p.id, p.name, p.contract_value, c.name as client_name, p.status
       FROM projects p
       LEFT JOIN contacts c ON p.client_id = c.id
       WHERE p.company_id = $1
       ORDER BY p.name`,
      [auth.companyId]
    );

    const result: any[] = [];
    for (const project of projects.rows) {
      const costs = await query(
        `SELECT COALESCE(SUM(jl.debit), 0) as total_costs
         FROM journal_lines jl
         JOIN accounts a ON jl.account_id = a.id
         WHERE (jl.project_id = $1 OR jl.journal_entry_id IN (SELECT id FROM journal_entries WHERE project_id = $1))
         AND a.type = 'expense'`,
        [project.id]
      );
      const totalCosts = parseFloat(costs.rows[0].total_costs) || 0;

      result.push({
        ...project,
        contract_value: parseFloat(project.contract_value) || 0,
        total_costs: totalCosts,
        profit: (parseFloat(project.contract_value) || 0) - totalCosts,
        profit_margin: (parseFloat(project.contract_value) || 0) > 0
          ? (((parseFloat(project.contract_value) || 0) - totalCosts) / (parseFloat(project.contract_value) || 0)) * 100
          : 0,
      });
    }

    return success({ projects: result });
  } catch (err) {
    return handleApiError(err);
  }
}
