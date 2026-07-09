import { NextRequest } from 'next/server';
import { success, error, requireApiAuth, handleApiError } from '@/lib/api-helpers';
import { getSupabase } from '@/lib/supabase-client';

// @ts-ignore
const sb = () => getSupabase() as any;

export async function GET(req: NextRequest) {
  try {
    const auth = await requireApiAuth(req);
    const projectId = req.nextUrl.searchParams.get('projectId');
    const type = req.nextUrl.searchParams.get('type') || 'project-costs';
    const s = sb();

    if (type === 'project-costs' && projectId) {
      // Material costs
      const { data: materials } = await s.from('inventory_transactions')
        .select('total_value')
        .eq('company_id', auth.companyId)
        .eq('project_id', projectId)
        .eq('type', 'issue');

      const materialTotal = (materials || []).reduce((sum: number, m: any) => sum + (parseFloat(m.total_value) || 0), 0);

      // Worker costs
      const { data: workers } = await s.from('daily_worker_records')
        .select('wage, days')
        .eq('company_id', auth.companyId)
        .eq('project_id', projectId);

      const workerTotal = (workers || []).reduce((sum: number, w: any) => sum + ((parseFloat(w.wage) || 0) * (parseFloat(w.days) || 0)), 0);

      // Purchase costs
      const { data: purchases } = await s.from('purchase_invoices')
        .select('total')
        .eq('company_id', auth.companyId)
        .eq('project_id', projectId)
        .neq('status', 'cancelled');

      const purchaseTotal = (purchases || []).reduce((sum: number, p: any) => sum + (parseFloat(p.total) || 0), 0);

      // Subcontractor costs
      const { data: contracts } = await s.from('subcontractor_contracts')
        .select('id')
        .eq('company_id', auth.companyId)
        .eq('project_id', projectId);

      const contractIds = (contracts || []).map((c: any) => c.id);
      let subTotal = 0;

      if (contractIds.length > 0) {
        const { data: certs } = await s.from('subcontractor_certificates')
          .select('amount')
          .in('contract_id', contractIds)
          .eq('status', 'paid');

        subTotal = (certs || []).reduce((sum: number, sc: any) => sum + (parseFloat(sc.amount) || 0), 0);
      }

      return success({
        materials: materialTotal,
        workers: workerTotal,
        purchases: purchaseTotal,
        subcontractors: subTotal,
        total: materialTotal + workerTotal + purchaseTotal + subTotal,
      });
    }

    if (type === 'material-issuances') {
      const { data: result } = await s.from('inventory_transactions')
        .select('*, inventory_items(name, code), projects(name)')
        .eq('company_id', auth.companyId)
        .in('type', ['issue', 'return'])
        .order('date', { ascending: false })
        .limit(100);

      return success((result || []).map((it: any) => ({
        ...it,
        item_name: it.inventory_items?.name || null,
        item_code: it.inventory_items?.code || null,
        project_name: it.projects?.name || null,
      })));
    }

    if (type === 'inventory-transfers') {
      const { data: result } = await s.from('inventory_transactions')
        .select('*, inventory_items(name, code)')
        .eq('company_id', auth.companyId)
        .eq('type', 'transfer')
        .order('date', { ascending: false })
        .limit(100);

      return success((result || []).map((it: any) => ({
        ...it,
        item_name: it.inventory_items?.name || null,
        item_code: it.inventory_items?.code || null,
      })));
    }

    return error('Invalid type or missing projectId');
  } catch (err) {
    return handleApiError(err);
  }
}
