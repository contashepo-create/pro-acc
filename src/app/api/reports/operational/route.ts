import { NextRequest } from 'next/server';
import { query } from '@/lib/db';
import { success, error, requireApiAuth, handleApiError } from '@/lib/api-helpers';

export async function GET(req: NextRequest) {
  try {
    const auth = await requireApiAuth(req);
    const projectId = req.nextUrl.searchParams.get('projectId');
    const type = req.nextUrl.searchParams.get('type') || 'project-costs';

    if (type === 'project-costs' && projectId) {
      // Material costs from inventory
      const materials = await query(
        `SELECT SUM(total_value) as total FROM inventory_transactions
         WHERE company_id = $1 AND project_id = $2 AND type = 'issue'`,
        [auth.companyId, projectId]
      );

      // Worker costs
      const workers = await query(
        `SELECT SUM(wage * days) as total FROM daily_worker_records
         WHERE company_id = $1 AND project_id = $2`,
        [auth.companyId, projectId]
      );

      // Purchase costs
      const purchases = await query(
        `SELECT SUM(total) as total FROM purchase_invoices
         WHERE company_id = $1 AND project_id = $2 AND status != 'cancelled'`,
        [auth.companyId, projectId]
      );

      // Subcontractor costs
      const subcontractors = await query(
        `SELECT SUM(amount) as total FROM subcontractor_certificates sc
         JOIN subcontractor_contracts sct ON sct.id = sc.contract_id
         WHERE sct.company_id = $1 AND sct.project_id = $2 AND sc.status = 'paid'`,
        [auth.companyId, projectId]
      );

      return success({
        materials: materials.rows[0]?.total || 0,
        workers: workers.rows[0]?.total || 0,
        purchases: purchases.rows[0]?.total || 0,
        subcontractors: subcontractors.rows[0]?.total || 0,
        total: (materials.rows[0]?.total || 0) + (workers.rows[0]?.total || 0) +
               (purchases.rows[0]?.total || 0) + (subcontractors.rows[0]?.total || 0),
      });
    }

    if (type === 'material-issuances') {
      const result = await query(
        `SELECT it.*, i.name as item_name, i.code as item_code, p.name as project_name
         FROM inventory_transactions it
         LEFT JOIN inventory_items i ON i.id = it.item_id
         LEFT JOIN projects p ON p.id = it.project_id
         WHERE it.company_id = $1 AND it.type IN ('issue', 'return')
         ORDER BY it.date DESC LIMIT 100`,
        [auth.companyId]
      );
      return success(result.rows);
    }

    if (type === 'inventory-transfers') {
      const result = await query(
        `SELECT it.*, i.name as item_name, i.code as item_code,
         w1.name as from_warehouse, w2.name as to_warehouse
         FROM inventory_transactions it
         LEFT JOIN inventory_items i ON i.id = it.item_id
         LEFT JOIN warehouses w1 ON w1.id = it.warehouse_id
         LEFT JOIN warehouses w2 ON w2.id = it.reference_id::uuid
         WHERE it.company_id = $1 AND it.type = 'transfer'
         ORDER BY it.date DESC LIMIT 100`,
        [auth.companyId]
      );
      return success(result.rows);
    }

    return error('Invalid type or missing projectId');
  } catch (err) {
    return handleApiError(err);
  }
}
