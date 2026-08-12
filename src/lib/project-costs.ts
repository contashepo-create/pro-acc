import { getSupabase } from '@/lib/supabase-client';

const round2 = (n: number) => Math.round((n + Number.EPSILON) * 100) / 100;

export function accumulateProjectLine(
  acc: { expenses: number; revenue: number },
  line: { type?: string | null; debit?: number; credit?: number },
) {
  const debit = Number(line.debit) || 0;
  const credit = Number(line.credit) || 0;
  if (line.type === 'expense') acc.expenses += debit - credit;
  if (line.type === 'revenue') acc.revenue += credit - debit;
  return acc;
}

/**
 * تكلفة/إيراد المشروع = سطور القيد الموسومة بـ project_id فقط.
 * 1150/1130/2110 أصول وخصوم فلا تُحتسب تكلفة.
 * مصروف (5100…) مدين − دائن. إيراد (4100…) دائن − مدين.
 */
export async function sumProjectJournal(companyId: string, projectId: string) {
  const s = getSupabase();
  let res = await s.from('journal_lines')
    .select('debit, credit, account_id, accounts(code, name, type)')
    .eq('company_id', companyId)
    .eq('project_id', projectId);
  if (res.error) {
    res = await s.from('journal_lines')
      .select('debit, credit, account_id')
      .eq('company_id', companyId)
      .eq('project_id', projectId);
    if (res.error) throw res.error;
  }
  const lines = res.data || [];
  const needTypes = lines.some((l: any) => !l.accounts);
  let typeById = new Map<string, { code: string; name: string; type: string }>();
  if (needTypes) {
    const ids = [...new Set(lines.map((l: any) => l.account_id).filter(Boolean))];
    if (ids.length) {
      const { data: accs } = await s.from('accounts').select('id, code, name, type').in('id', ids).eq('company_id', companyId);
      typeById = new Map((accs || []).map((a: any) => [a.id, a]));
    }
  }

  let expenses = 0;
  let revenue = 0;
  const byAccount: Record<string, { code: string; name: string; type: string; debit: number; credit: number }> = {};

  for (const l of lines || []) {
    const acc = (l as any).accounts || typeById.get((l as any).account_id);
    if (!acc) continue;
    const debit = parseFloat((l as any).debit) || 0;
    const credit = parseFloat((l as any).credit) || 0;
    if (!byAccount[acc.code]) {
      byAccount[acc.code] = { code: acc.code, name: acc.name, type: acc.type, debit: 0, credit: 0 };
    }
    byAccount[acc.code].debit += debit;
    byAccount[acc.code].credit += credit;
    if (acc.type === 'expense') expenses += debit - credit;
    else if (acc.type === 'revenue') revenue += credit - debit;
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
  let batch = await s.from('journal_lines')
    .select('project_id, account_id, debit, credit, accounts(type)')
    .eq('company_id', companyId)
    .in('project_id', projectIds);
  if (batch.error) {
    batch = await s.from('journal_lines')
      .select('project_id, account_id, debit, credit')
      .eq('company_id', companyId)
      .in('project_id', projectIds);
    if (batch.error) throw batch.error;
  }
  const lines = batch.data || [];
  const typeById = new Map<string, string>();
  if (lines.some((l: any) => !l.accounts)) {
    const ids = [...new Set(lines.map((l: any) => l.account_id).filter(Boolean))];
    if (ids.length) {
      const { data: accs } = await s.from('accounts').select('id, type').in('id', ids).eq('company_id', companyId);
      for (const a of accs || []) typeById.set(a.id, a.type);
    }
  }

  for (const l of lines) {
    const pid = (l as any).project_id;
    if (!pid || !map[pid]) continue;
    const accType = (l as any).accounts?.type || typeById.get((l as any).account_id);
    if (!accType) continue;
    const debit = parseFloat((l as any).debit) || 0;
    const credit = parseFloat((l as any).credit) || 0;
    if (accType === 'expense') map[pid].expenses += debit - credit;
    if (accType === 'revenue') map[pid].revenue += credit - debit;
  }
  return map;
}
