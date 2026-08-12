import { NextRequest } from 'next/server';
import { success, error, requireApiAuth, handleApiError, requireModulePermission } from '@/lib/api-helpers';
import { getSupabase } from '@/lib/supabase-client';

const sb = () => getSupabase();

/**
 * GET /api/projects/costs?projectId=
 * تحليل تكاليف/إيرادات مشروع من سطور القيد الموسومة بـ project_id.
 *
 * FIX: سابقاً كان يجمع السطور مرتين (مرة عبر journal_entries.project_id ومرة
 * عبر journal_lines.project_id مباشرة) فتتضخّم التكاليف، والاستعلام المباشر
 * لم يكن مقيداً بالشركة. الآن مصدر واحد مقيد بالشركة + التحقق من انتماء
 * المشروع للشركة.
 */
export async function GET(request: NextRequest) {
  try {
    const auth = await requireModulePermission(request, 'projects', 'read');
    const s = sb();
    const url = new URL(request.url);
    const projectId = url.searchParams.get('projectId');

    if (!projectId) return error('رقم المشروع مطلوب');

    // TENANT: المشروع يجب أن ينتمي للشركة
    const { data: project } = await s.from('projects')
      .select('id').eq('id', projectId).eq('company_id', auth.companyId).maybeSingle();
    if (!project) return error('المشروع غير موجود', 404);

    // مصدر واحد: سطور القيد الموسومة بـ project_id (مقيدة بالشركة)
    const { data: lines } = await s.from('journal_lines')
      .select('debit, credit, accounts(code, name, type)')
      .eq('project_id', projectId)
      .eq('company_id', auth.companyId);

    const accountMap: Record<string, { code: string; name: string; type: string; total_debit: number; total_credit: number }> = {};
    let totalRevenue = 0;
    let grandTotal = 0;

    for (const l of (lines || [])) {
      const acc = l.accounts as any;
      if (!acc) continue;
      const key = acc.code;
      if (!accountMap[key]) {
        accountMap[key] = { code: acc.code, name: acc.name, type: acc.type, total_debit: 0, total_credit: 0 };
      }
      const debit = parseFloat(l.debit) || 0;
      const credit = parseFloat(l.credit) || 0;
      accountMap[key].total_debit += debit;
      accountMap[key].total_credit += credit;
      // الإيراد دائنٌ بالطبيعة (credit − debit = موجب)، والمصروف مدينٌ (debit − credit = موجب)
      const net = acc.type === 'revenue' ? (credit - debit) : (debit - credit);
      if (acc.type === 'revenue') totalRevenue += net;
      if (acc.type === 'expense') grandTotal += net;
    }

    const expenseRows = Object.values(accountMap).sort((a, b) => a.code.localeCompare(b.code));

    const categories: Record<string, { code: string; name: string; total: number; items: any[] }> = {
      materials: { code: '5110', name: 'المواد', total: 0, items: [] },
      labor: { code: '5210', name: 'العمالة', total: 0, items: [] },
      subcontractor: { code: '2150', name: 'مقاولين باطن', total: 0, items: [] },
      equipment: { code: '5200', name: 'معدات', total: 0, items: [] },
      other: { code: '5000', name: 'مصروفات أخرى', total: 0, items: [] },
    };

    for (const row of expenseRows) {
      const netAmount = row.total_debit - row.total_credit;
      if (netAmount === 0) continue;
      const item = { account_id: row.code, account_code: row.code, account_name: row.name, debit: row.total_debit, credit: row.total_credit, net: netAmount };
      const code = row.code;
      if (code.startsWith('511')) { categories.materials.total += netAmount; categories.materials.items.push(item); }
      else if (code.startsWith('521') || code.startsWith('522')) { categories.labor.total += netAmount; categories.labor.items.push(item); }
      else if (code.startsWith('215')) { categories.subcontractor.total += netAmount; categories.subcontractor.items.push(item); }
      else if (code.startsWith('52') && !code.startsWith('521')) { categories.equipment.total += netAmount; categories.equipment.items.push(item); }
      else if (row.type === 'expense') { categories.other.total += netAmount; categories.other.items.push(item); }
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
