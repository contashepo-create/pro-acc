import { getSupabase } from '@/lib/supabase-client';

import type { Row } from './types';

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

export async function sumProjectJournal(companyId: string, projectId: string, from?: string | null, to?: string | null) {
  const { data, error } = await getSupabase().rpc('get_project_account_totals', {
    p_company_id: companyId, p_project_ids: [projectId], p_from: from || null, p_to: to || null,
  });
  if (error) throw error;
  let expenses = 0;
  let revenue = 0;
  const accounts = ((data ?? []) as Row[]).map((row: Row) => {
    const debit = Number(row.debit) || 0;
    const credit = Number(row.credit) || 0;
    if (row.account_type === 'expense') expenses += debit - credit;
    if (row.account_type === 'revenue') revenue += credit - debit;
    return { code: row.code, name: row.name, type: row.account_type, debit, credit };
  });
  return {
    expenses: round2(expenses), revenue: round2(revenue), profit: round2(revenue - expenses), accounts,
  };
}

export async function sumProjectsJournal(
  companyId: string, projectIds: string[], from?: string | null, to?: string | null,
) {
  const map: Record<string, { expenses: number; revenue: number }> = {};
  for (const id of projectIds) map[id] = { expenses: 0, revenue: 0 };
  if (!projectIds.length) return map;
  const { data, error } = await getSupabase().rpc('get_project_account_totals', {
    p_company_id: companyId, p_project_ids: projectIds, p_from: from || null, p_to: to || null,
  });
  if (error) throw error;
  for (const row of (data ?? []) as Row[]) {
    const pid = String(row.project_id);
    if (!map[pid]) continue;
    const debit = Number(row.debit) || 0;
    const credit = Number(row.credit) || 0;
    if (row.account_type === 'expense') map[pid].expenses += debit - credit;
    if (row.account_type === 'revenue') map[pid].revenue += credit - debit;
  }
  for (const value of Object.values(map)) {
    value.expenses = round2(value.expenses);
    value.revenue = round2(value.revenue);
  }
  return map;
}
