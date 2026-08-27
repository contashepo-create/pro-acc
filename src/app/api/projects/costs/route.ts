import { NextRequest } from 'next/server';
import { success, error, handleApiError, requireModulePermission } from '@/lib/api-helpers';
import { getSupabase } from '@/lib/supabase-client';
import { deliveryUuid } from '@/lib/project-delivery-validation';
import { classifyProjectCost, PROJECT_COST_CATEGORY_LABELS, type ProjectCostCategory } from '@/lib/project-cost-classifier';

import type { Row } from '@/lib/types';

const sb = () => getSupabase();

/**
 * GET /api/projects/costs?projectId=
 * تحليل تكاليف/إيرادات مشروع من سطور القيد الموسومة بـ project_id.
 *
 * Integrity rules (matching the DB-side `get_project_account_totals`):
 *  - Single source: `journal_lines.project_id` (tenant-scoped).
 *  - Only lines whose journal entry is POSTED (or reversed) and NOT deleted
 *    are included — draft/pending/deleted entries must never inflate costs.
 *  - Cost accounts are categorized through the shared canonical classifier so
 *    the breakdown matches the other profitability reports.
 */
export async function GET(request: NextRequest) {
  try {
    const auth = await requireModulePermission(request, 'projects', 'read');
    const s = sb();
    const url = new URL(request.url);
    const projectId = url.searchParams.get('projectId');

    if (!projectId) return error('رقم المشروع مطلوب');
    if (!deliveryUuid.safeParse(projectId).success) return error('معرف المشروع غير صالح');

    // TENANT: المشروع يجب أن ينتمي للشركة
    const { data: project, error: projectError } = await s.from('projects')
      .select('id').eq('id', projectId).eq('company_id', auth.companyId).maybeSingle();
    if (projectError) throw projectError;
    if (!project) return error('المشروع غير موجود', 404);

    // مصدر واحد: سطور القيد الموسومة بـ project_id (مقيدة بالشركة) عبر القيود
    // المثبتة غير المحذوفة فقط، كما تفعل كل دوال التقارير المحاسبية الأخرى.
    const { data: lines, error: linesError } = await s.from('journal_lines')
      .select('debit, credit, journal_entries!inner(deleted_at, status, reversed_by), accounts(code, name, type)')
      .eq('project_id', projectId)
      .eq('company_id', auth.companyId)
      .or('journal_entries.status.eq.posted,journal_entries.reversed_by.not.is.null')
      .is('journal_entries.deleted_at', null);
    if (linesError) throw linesError;

    const accountMap: Record<string, { code: string; name: string; type: string; total_debit: number; total_credit: number }> = {};
    let totalRevenue = 0;
    let grandTotal = 0;

    for (const l of (lines || [])) {
      const acc = l.accounts as Row;
      if (!acc) continue;
      const key = String(acc.code);
      if (!accountMap[key]) {
        accountMap[key] = { code: String(acc.code), name: String(acc.name), type: String(acc.type), total_debit: 0, total_credit: 0 };
      }
      const debit = parseFloat(String(l.debit)) || 0;
      const credit = parseFloat(String(l.credit)) || 0;
      accountMap[key].total_debit += debit;
      accountMap[key].total_credit += credit;
      // الإيراد دائنٌ بالطبيعة (credit − debit = موجب)، والمصروف مدينٌ (debit − credit = موجب)
      const net = acc.type === 'revenue' ? (credit - debit) : (debit - credit);
      if (acc.type === 'revenue') totalRevenue += net;
      if (acc.type === 'expense') grandTotal += net;
    }

    const expenseRows = Object.values(accountMap).sort((a, b) => a.code.localeCompare(b.code));

    const categories: Record<ProjectCostCategory, { code: string; name: string; total: number; items: Row[] }> = {
      materials: { code: '5110', name: PROJECT_COST_CATEGORY_LABELS.materials, total: 0, items: [] },
      labor: { code: '5120', name: PROJECT_COST_CATEGORY_LABELS.labor, total: 0, items: [] },
      subcontractor: { code: '5130', name: PROJECT_COST_CATEGORY_LABELS.subcontractor, total: 0, items: [] },
      equipment: { code: '5140', name: PROJECT_COST_CATEGORY_LABELS.equipment, total: 0, items: [] },
      other: { code: '5400', name: PROJECT_COST_CATEGORY_LABELS.other, total: 0, items: [] },
    };

    for (const row of expenseRows) {
      const netAmount = row.total_debit - row.total_credit;
      if (netAmount === 0) continue;
      const item = { account_id: row.code, account_code: row.code, account_name: row.name, debit: row.total_debit, credit: row.total_credit, net: netAmount };
      const category = classifyProjectCost(row.code);
      categories[category].total += netAmount;
      categories[category].items.push(item);
    }

    return success({
      project_id: projectId,
      categories: Object.values(categories).filter((c) => c.total > 0),
      grand_total: grandTotal,
      total_revenue: totalRevenue,
      net_profit: totalRevenue - grandTotal,
      raw_lines: expenseRows,
    });
  } catch (err) {
    return handleApiError(err);
  }
}
