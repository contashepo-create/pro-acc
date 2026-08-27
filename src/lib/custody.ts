/**
 * محرك ملفات العهد:
 * - أكثر من ملف لنفس الموظف، مشروع اختياري
 * - التعزيز والإثبات يخصمان 1150 دون صرف المصروف مرتين
 * - الإغلاق بتأكيد فقط: عجز → 1160 / زيادة → 2140
 */
import { getSupabase } from '@/lib/supabase-client';

import type { Row } from './types';

const sb = () => getSupabase();
export const round2 = (n: number) => Math.round((n + Number.EPSILON) * 100) / 100;

export const OPEN_STATUSES = new Set(['open', 'partially_settled']);

export async function loadCustodyFile(
  companyId: string,
  id: string,
): Promise<
  | null
  | (Row & {
      employee_name: string;
      project_name: string | null;
      bank_name: string | null;
      transactions: Row[];
      deposits: Row[];
      expenses: Row[];
      other: Row[];
      total_received: number;
      total_expenses: number;
      remaining_amount: number;
      computed_status: string;
      is_closed: boolean;
    })
> {
  const s = sb();
  let row: Row | null = null;
  const primary = await s.from('custodies')
    .select('*, employees(name), projects(name), banks_safes(name)')
    .eq('id', id).eq('company_id', companyId).maybeSingle();
  if (primary.error) {
    const fb = await s.from('custodies').select('*').eq('id', id).eq('company_id', companyId).maybeSingle();
    if (fb.error) throw fb.error;
    row = fb.data;
  } else {
    row = primary.data;
  }
  if (!row) return null;

  let txs: Row[] = [];
  const t = await s.from('custody_transactions')
    .select('*').eq('custody_id', id).eq('company_id', companyId).order('created_at', { ascending: true });
  if (!t.error) txs = t.data || [];

  const deposits = txs.filter((x) => x.type === 'addition' || x.type === 'deposit' || x.type === 'open');
  const expenses = txs.filter((x) => x.type === 'expense');
  const other = txs.filter((x) => !['addition', 'deposit', 'open', 'expense'].includes(String(x.type)));

  const totalReceived = round2(
    deposits.reduce((sum, x) => sum + (parseFloat(String(x.amount)) || 0), 0)
    || parseFloat(String(row.total_received)) || parseFloat(String(row.amount)) || 0,
  );
  const totalExpenses = round2(expenses.reduce((sum, x) => sum + (parseFloat(String(x.amount)) || 0), 0));
  const status = row.status === 'settled' || row.status === 'closed'
    ? 'settled'
    : totalExpenses > 0 ? 'partially_settled' : 'open';
  const remaining = status === 'settled'
    ? 0
    : round2(Math.max(0, totalReceived - totalExpenses));

  return {
    ...row,
    employee_name: String(((row.employees ?? null) as Row | null)?.name || ''),
    project_name: String(((row.projects ?? null) as Row | null)?.name || '') || null,
    bank_name: String(((row.banks_safes ?? null) as Row | null)?.name || '') || null,
    transactions: txs,
    deposits,
    expenses,
    other,
    total_received: totalReceived,
    total_expenses: totalExpenses,
    remaining_amount: remaining,
    computed_status: status,
    is_closed: status === 'settled',
  };
}

export function assertFileOpen(file: Row) {
  const st = file.status;
  if (st === 'settled' || st === 'closed') {
    throw new Error('ملف العهدة مغلق — لا يمكن تسجيل حركات عليه');
  }
}
