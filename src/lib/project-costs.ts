import { getSupabase } from '@/lib/supabase-client';

const round2 = (n: number) => Math.round((n + Number.EPSILON) * 100) / 100;

/**
 * تكلفة/إيراد المشروع = سطور القيد الموسومة بـ project_id فقط.
 * 1150/1130/2110 أصول وخصوم فلا تُحتسب تكلفة.
 * مصروف (5100…) مدين − دائن. إيراد (4100…) دائن − مدين.
 */
export async function sumProjectJournal(companyId: string, projectId: string) {
  const s = getSupabase();
  const { data: lines, error } = await s.from('journal_lines')
    .select('debit, credit, accounts(code, name, type)')
    .eq('company_id', companyId)
    .eq('project_id', projectId);
  if (error) throw error;

  let expenses = 0;
  let revenue = 0;
  const byAccount: Record<string, { code: string; name: string; type: string; debit: number; credit: number }> = {};

  for (const l of lines || []) {
    const acc = (l as any).accounts;
    if (!acc) continue;
    const debit = parseFloat((l as any).debit) || 0;
    const credit = parseFloat((l as any).credit) || 0;
    if (!byAccount[acc.code]) {
      byAccount[acc.code] = { code: acc.code, name: acc.name, type: acc.type, debit: 0, credit: 0 };
    }
    byAccount[acc.code].debit += debit;
    byAccount[acc.code].credit += credit;
    if (acc.type === 'expense') expenses += debit - credit;
    if (acc.type === 'revenue') revenue += credit - debit;
  }

  return {
    expenses: round2(expenses),
    revenue: round2(revenue),
    profit: round2(revenue - expenses),
    accounts: Object.values(byAccount),
  };
}

export async function sumProjectsJournal(companyId: string, projectIds: string[]) {
  const map: Record<string, { expenses: number; revenue: number }> = {};
  for (const id of projectIds) map[id] = { expenses: 0, revenue: 0 };
  if (projectIds.length === 0) return map;

  const s = getSupabase();
  const { data: lines, error } = await s.from('journal_lines')
    .select('project_id, debit, credit, accounts(type)')
    .eq('company_id', companyId)
    .in('project_id', projectIds);
  if (error) throw error;

  for (const l of lines || []) {
    const pid = (l as any).project_id;
    if (!pid || !map[pid]) continue;
    const acc = (l as any).accounts;
    if (!acc) continue;
    const debit = parseFloat((l as any).debit) || 0;
    const credit = parseFloat((l as any).credit) || 0;
    if (acc.type === 'expense') map[pid].expenses += debit - credit;
    if (acc.type === 'revenue') map[pid].revenue += credit - debit;
  }
  return map;
}
