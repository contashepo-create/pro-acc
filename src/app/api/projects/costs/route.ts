import { NextRequest } from 'next/server';
import { success, error, requireApiAuth, handleApiError } from '@/lib/api-helpers';
import { getSupabase } from '@/lib/supabase-client';

const sb = () => getSupabase();

export async function GET(request: NextRequest) {
  try {
    const auth = await requireApiAuth(request);
    const s = sb();
    const url = new URL(request.url);
    const projectId = url.searchParams.get('projectId');

    if (!projectId) return error('رقم المشروع مطلوب');

    // Get journal entries for this project
    const { data: jes } = await s.from('journal_entries')
      .select('id').eq('project_id', projectId).eq('company_id', auth.companyId);
    const jeIds = (jes || []).map((je: any) => je.id);

    let expenseRows: any[] = [];
    let totalRevenue = 0;
    let grandTotal = 0;

    if (jeIds.length > 0) {
      const { data: lines } = await s.from('journal_lines')
        .select('debit, credit, accounts(code, name, type)')
        .in('journal_entry_id', jeIds);

      const accountMap: Record<string, { code: string; name: string; type: string; total_debit: number; total_credit: number }> = {};

      for (const l of (lines || [])) {
        const acc = l.accounts as any;
        if (!acc) continue;
        const key = acc.code;
        if (!accountMap[key]) {
          accountMap[key] = { code: acc.code, name: acc.name, type: acc.type, total_debit: 0, total_credit: 0 };
        }
        accountMap[key].total_debit += parseFloat(l.debit) || 0;
        accountMap[key].total_credit += parseFloat(l.credit) || 0;
      }

      expenseRows = Object.values(accountMap).sort((a, b) => a.code.localeCompare(b.code));

      for (const row of expenseRows) {
        const net = row.total_debit - row.total_credit;
        if (row.type === 'revenue') totalRevenue += net;
        if (row.type === 'expense') grandTotal += net;
      }
    }

    // Also check journal_lines with project_id directly
    const { data: directLines } = await s.from('journal_lines')
      .select('debit, credit, accounts(code, name, type)').eq('project_id', projectId);

    const accountMap2: Record<string, { code: string; name: string; type: string; total_debit: number; total_credit: number }> = {};
    for (const l of (directLines || [])) {
      const acc = l.accounts as any;
      if (!acc) continue;
      const key = acc.code;
      if (!accountMap2[key]) {
        accountMap2[key] = { code: acc.code, name: acc.name, type: acc.type, total_debit: 0, total_credit: 0 };
      }
      accountMap2[key].total_debit += parseFloat(l.debit) || 0;
      accountMap2[key].total_credit += parseFloat(l.credit) || 0;
      const net = (parseFloat(l.debit) || 0) - (parseFloat(l.credit) || 0);
      if (acc.type === 'revenue') totalRevenue += net;
      if (acc.type === 'expense') grandTotal += net;
    }

    const allRows = [...expenseRows, ...Object.values(accountMap2)];
    const categories: Record<string, { code: string; name: string; total: number; items: any[] }> = {
      materials: { code: '5110', name: 'المواد', total: 0, items: [] },
      labor: { code: '5210', name: 'العمالة', total: 0, items: [] },
      subcontractor: { code: '2150', name: 'مقاولين باطن', total: 0, items: [] },
      equipment: { code: '5200', name: 'معدات', total: 0, items: [] },
      other: { code: '5000', name: 'مصروفات أخرى', total: 0, items: [] },
    };

    for (const row of allRows) {
      const code = row.code;
      const debit = row.total_debit;
      const credit = row.total_credit;
      const netAmount = debit - credit;
      if (netAmount === 0) continue;

      const item = { account_id: code, account_code: code, account_name: row.name, debit, credit, net: netAmount };
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
      raw_lines: allRows,
    });
  } catch (err) {
    return handleApiError(err);
  }
}
