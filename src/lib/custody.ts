/**
 * محرك ملفات العهد:
 * - أكثر من ملف لنفس الموظف، مشروع اختياري
 * - التعزيز والإثبات يخصمان 1150 دون صرف المصروف مرتين
 * - الإغلاق بتأكيد فقط: عجز → 1160 / زيادة → 2140
 */
import { getSupabase } from '@/lib/supabase-client';
import { createJournalEntry } from '@/lib/journal-utils';
import { ACCOUNT_CODES } from '@/lib/constants';

const sb = () => getSupabase();
export const round2 = (n: number) => Math.round((n + Number.EPSILON) * 100) / 100;

export const OPEN_STATUSES = new Set(['open', 'partially_settled']);

export async function resolveCustodyAccounts(companyId: string) {
  const s = sb();
  const { data: custody } = await s.from('accounts').select('id').eq('company_id', companyId).eq('code', ACCOUNT_CODES.EMPLOYEE_CUSTODIES).maybeSingle();
  const { data: advance } = await s.from('accounts').select('id').eq('company_id', companyId).eq('code', ACCOUNT_CODES.EMPLOYEE_ADVANCES).maybeSingle();
  const { data: accrued } = await s.from('accounts').select('id').eq('company_id', companyId).eq('code', ACCOUNT_CODES.ACCRUED_SALARIES).maybeSingle();
  const { data: expense } = await s.from('accounts').select('id').eq('company_id', companyId).eq('code', ACCOUNT_CODES.DIRECT_COSTS).maybeSingle();
  if (!custody?.id) throw new Error('حساب عُهد الموظفين (1150) غير موجود — راجع دليل الحسابات');
  return {
    custodyId: custody.id,
    advanceId: advance?.id || null,
    accruedId: accrued?.id || null,
    defaultExpenseId: expense?.id || null,
  };
}

export async function loadCustodyFile(companyId: string, id: string) {
  const s = sb();
  let row: any = null;
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

  let txs: any[] = [];
  const t = await s.from('custody_transactions')
    .select('*').eq('custody_id', id).eq('company_id', companyId).order('created_at', { ascending: true });
  if (!t.error) txs = t.data || [];

  const deposits = txs.filter((x) => x.type === 'addition' || x.type === 'deposit' || x.type === 'open');
  const expenses = txs.filter((x) => x.type === 'expense');
  const other = txs.filter((x) => !['addition', 'deposit', 'open', 'expense'].includes(x.type));

  const totalReceived = round2(
    deposits.reduce((sum, x) => sum + (parseFloat(x.amount) || 0), 0)
    || parseFloat(row.total_received) || parseFloat(row.amount) || 0,
  );
  const totalExpenses = round2(expenses.reduce((sum, x) => sum + (parseFloat(x.amount) || 0), 0));
  const status = row.status === 'settled' || row.status === 'closed'
    ? 'settled'
    : totalExpenses > 0 ? 'partially_settled' : 'open';
  const remaining = status === 'settled'
    ? 0
    : round2(Math.max(0, totalReceived - totalExpenses));

  return {
    ...row,
    employee_name: (row as any).employees?.name || '',
    project_name: (row as any).projects?.name || null,
    bank_name: (row as any).banks_safes?.name || null,
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

export function assertFileOpen(file: { status?: string }) {
  if (file.status === 'settled' || file.status === 'closed') {
    throw new Error('ملف العهدة مغلق — لا يمكن تسجيل حركات عليه');
  }
}

export async function nextFileNumber(companyId: string): Promise<string> {
  const s = sb();
  const year = new Date().getFullYear();
  const { count } = await s.from('custodies')
    .select('id', { count: 'exact', head: true })
    .eq('company_id', companyId);
  return `عهدة-${year}-${String((count || 0) + 1).padStart(4, '0')}`;
}

export async function recordCustodyTx(
  companyId: string,
  custodyId: string,
  type: string,
  amount: number,
  description: string,
  userId: string,
  extra: Record<string, unknown> = {},
) {
  const s = sb();
  const { data, error } = await s.from('custody_transactions').insert({
    company_id: companyId,
    custody_id: custodyId,
    type,
    amount,
    description,
    created_by: userId,
    ...extra,
  }).select('*').single();
  if (error) throw error;
  return data;
}

export async function syncCustodyTotals(companyId: string, custodyId: string) {
  const file = await loadCustodyFile(companyId, custodyId);
  if (!file) return null;
  // عمود status في بعض القواعد لا يقبل partially_settled
  const status = file.is_closed ? 'settled' : 'open';
  await sb().from('custodies').update({
    amount: file.total_received,
    total_received: file.total_received,
    total_expenses: file.total_expenses,
    remaining_amount: file.remaining_amount,
    status,
    updated_at: new Date().toISOString(),
  }).eq('id', custodyId).eq('company_id', companyId);
  return { ...file, status };
}
