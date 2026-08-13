import { NextRequest } from 'next/server';
import { success, requireModulePermission, handleApiError } from '@/lib/api-helpers';
import { getSupabase } from '@/lib/supabase-client';

const sb = () => getSupabase();

/**
 * Cost Center Profitability Report (تقرير ربحية مراكز التكلفة)
 *
 * ملاحظة معمارية: وسْم cost_center_id على سطور القيد يُضاف في ترحيلة لاحقة
 * (migrations). هذا التقرير يقرأ الوسْم إن وُجد، ويعيد رسالة صريحة إن كان
 * العمود غير متاح بعد — بدل إظهار أصفار صامتة توحي بأن المراكز بلا أرباح.
 */
export async function GET(request: NextRequest) {
  try {
    const auth = await requireModulePermission(request, 'financial_reports', 'read');
    const s = sb();
    const url = new URL(request.url);
    const from = url.searchParams.get('from');
    const to = url.searchParams.get('to');

    const { data: costCenters, error: ccErr } = await s.from('cost_centers')
      .select('id, code, name')
      .eq('company_id', auth.companyId)
      .eq('is_active', true)
      .order('code');

    if (ccErr) {
      // جدول مراكز التكلفة غير موجود — تقرير غير قابل للتشغيل
      if (/relation|42P01|Could not find/i.test(ccErr.message || '')) {
        return success({ cost_centers: [], message: 'جدول مراكز التكلفة غير مفعّل في قاعدة البيانات هذه', available: false });
      }
      throw ccErr;
    }

    if (!costCenters || costCenters.length === 0) {
      return success({ cost_centers: [], message: 'لا توجد مراكز تكلفة', available: true });
    }

    // فحص قدرة وسْم سطور القيد على مركز تكلفة مرة واحدة (وليس لكل مركز)
    const { data: probe, error: probeErr } = await s.from('journal_lines')
      .select('cost_center_id')
      .eq('company_id', auth.companyId)
      .limit(1);

    if (probeErr && /column|42703|Could not find/i.test(probeErr.message || '')) {
      return success({
        cost_centers: [],
        message: 'وسْم مراكز التكلفة على القيود غير مفعّل — لا يمكن حساب الربحية حالياً',
        available: false,
      });
    }
    if (probeErr) throw probeErr;

    // جلب القيود مرة واحدة (بدل مسح كامل لكل مركز — N+1 سابق)
    let entryQuery = s.from('journal_entries')
      .select('id')
      .eq('company_id', auth.companyId);
    if (from) entryQuery = entryQuery.gte('date', from);
    if (to) entryQuery = entryQuery.lte('date', to);
    const { data: entries, error: entriesErr } = await entryQuery;
    if (entriesErr) throw entriesErr;

    const entryIds = (entries || []).map((e: any) => e.id);

    // بنية موحدة: مركز → {revenue, expenses}
    const byCenter: Record<string, { revenue: number; expenses: number }> = {};
    for (const cc of costCenters) byCenter[cc.id] = { revenue: 0, expenses: 0 };

    if (entryIds.length > 0) {
      const { data: lines, error: linesErr } = await s.from('journal_lines')
        .select('debit, credit, cost_center_id, account_id, accounts!account_id(type)')
        .in('journal_entry_id', entryIds)
        .eq('company_id', auth.companyId);
      if (linesErr) throw linesErr;

      for (const line of lines || []) {
        const centerId = (line as any).cost_center_id;
        if (!centerId || !byCenter[centerId]) continue;
        const accType = (line as any).accounts?.type;
        const debit = parseFloat((line as any).debit) || 0;
        const credit = parseFloat((line as any).credit) || 0;

        if (accType === 'revenue') {
          byCenter[centerId].revenue += credit - debit;
        } else if (accType === 'expense') {
          byCenter[centerId].expenses += debit - credit;
        }
      }
    }

    const result = costCenters.map((cc: any) => {
      const { revenue, expenses } = byCenter[cc.id];
      const profit = revenue - expenses;
      const margin = revenue > 0 ? (profit / revenue) * 100 : 0;
      return { id: cc.id, code: cc.code, name: cc.name, revenue, expenses, profit, profit_margin: margin };
    });

    const total_revenue = result.reduce((s: number, c: any) => s + c.revenue, 0);
    const total_expenses = result.reduce((s: number, c: any) => s + c.expenses, 0);
    const total_profit = result.reduce((s: number, c: any) => s + c.profit, 0);

    return success({
      cost_centers: result,
      available: true,
      totals: {
        total_revenue,
        total_expenses,
        total_profit,
        overall_margin: total_revenue > 0 ? (total_profit / total_revenue) * 100 : 0,
      },
      period: { from, to },
    });
  } catch (err) {
    return handleApiError(err);
  }
}
