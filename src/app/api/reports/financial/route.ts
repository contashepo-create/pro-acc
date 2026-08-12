import { NextRequest } from 'next/server';
import { success, error, requireModulePermission, handleApiError } from '@/lib/api-helpers';
import { getSupabase } from '@/lib/supabase-client';
import {
  loadReportAccounts,
  loadReportJournalEntries,
  loadReportJournalLines,
  resolveLineAccountId,
} from '@/lib/report-journal';

const sb = () => getSupabase();

/**
 * GET /api/reports/financial
 * Financial statements (Trial Balance, Income Statement, Balance Sheet)
 * Built with professional double-entry accounting precision:
 * - Trial Balance: tracks opening balance, period debit/credit, and ending balance.
 * - Income Statement: period revenues and expenses between `from` and `to`.
 * - Balance Sheet: point-in-time cumulative position as of `to` date with net earnings included in equity.
 */
export async function GET(req: NextRequest) {
  try {
    const auth = await requireModulePermission(req, 'reports', 'read');
    const s = sb();
    const url = new URL(req.url);
    const type = url.searchParams.get('type') || 'trial_balance';
    const from = url.searchParams.get('from');
    const to = url.searchParams.get('to');

    const accounts = await loadReportAccounts(s, auth.companyId);
    if (!accounts || accounts.length === 0) {
      return success({ accounts: [], total_debit: 0, total_credit: 0 });
    }

    const byId = new Set(accounts.map((a) => a.id));
    const byCode = new Map(accounts.map((a) => [a.code, a.id]));

    // Cumulative up to `to`. Period vs opening is split below using `from`.
    const totalJes = await loadReportJournalEntries(s, auth.companyId, { to });
    const totalJeIds = totalJes.map((je) => je.id);

    const periodJeIdSet = new Set<string>();
    const priorJeIdSet = new Set<string>();
    for (const je of totalJes) {
      if (from && je.date < from) priorJeIdSet.add(je.id);
      else periodJeIdSet.add(je.id);
    }

    const rawLines = totalJeIds.length > 0
      ? await loadReportJournalLines(s, auth.companyId, totalJeIds)
      : [];
    const allLines = rawLines.map((l) => ({
      ...l,
      account_id: resolveLineAccountId(l, byId, byCode),
    }));

    // Accumulate balances
    const openingMap: Record<string, { debit: number; credit: number }> = {};
    const periodMap: Record<string, { debit: number; credit: number }> = {};
    const cumulativeMap: Record<string, { debit: number; credit: number }> = {};

    for (const l of allLines) {
      const accId = l.account_id;
      if (!accId) continue;
      const debit = parseFloat(l.debit) || 0;
      const credit = parseFloat(l.credit) || 0;

      // Cumulative (all up to `to`)
      if (!cumulativeMap[accId]) cumulativeMap[accId] = { debit: 0, credit: 0 };
      cumulativeMap[accId].debit += debit;
      cumulativeMap[accId].credit += credit;

      // Prior / Opening (< from)
      if (priorJeIdSet.has(l.journal_entry_id)) {
        if (!openingMap[accId]) openingMap[accId] = { debit: 0, credit: 0 };
        openingMap[accId].debit += debit;
        openingMap[accId].credit += credit;
      }

      // Period (from .. to)
      if (periodJeIdSet.has(l.journal_entry_id)) {
        if (!periodMap[accId]) periodMap[accId] = { debit: 0, credit: 0 };
        periodMap[accId].debit += debit;
        periodMap[accId].credit += credit;
      }
    }

    // ==========================================
    // 1. ميزان المراجعة (Trial Balance)
    // ==========================================
    if (type === 'trial_balance') {
      let totalDebit = 0;
      let totalCredit = 0;

      const result = accounts.map((a: any) => {
        // When from is provided, show period movements; balance is cumulative
        const period = from ? (periodMap[a.id] || { debit: 0, credit: 0 }) : (cumulativeMap[a.id] || { debit: 0, credit: 0 });
        const cumulative = cumulativeMap[a.id] || { debit: 0, credit: 0 };

        const balance = cumulative.debit - cumulative.credit;

        let normal_balance: string;
        if (['asset', 'expense'].includes(a.type)) {
          normal_balance = balance >= 0 ? 'debit' : 'credit';
        } else {
          normal_balance = balance <= 0 ? 'credit' : 'debit';
        }

        totalDebit += period.debit;
        totalCredit += period.credit;

        return { 
          id: a.id, 
          code: a.code, 
          name: a.name, 
          type: a.type, 
          total_debit: period.debit, 
          total_credit: period.credit, 
          balance, 
          normal_balance 
        };
      }).sort((a, b) => a.code.localeCompare(b.code));

      return success({ accounts: result, total_debit: totalDebit, total_credit: totalCredit });
    }

    // ==========================================
    // 2. قائمة الدخل (Income Statement / P&L)
    // ==========================================
    if (type === 'income_statement') {
      // Income statement strictly reflects the requested period (between `from` and `to`)
      const revenue = accounts.filter((a: any) => a.type === 'revenue').map((a: any) => {
        const p = from ? (periodMap[a.id] || { debit: 0, credit: 0 }) : (cumulativeMap[a.id] || { debit: 0, credit: 0 });
        return { id: a.id, code: a.code, name: a.name, amount: Math.max(0, p.credit - p.debit) };
      }).filter(r => r.amount > 0).sort((a, b) => a.code.localeCompare(b.code));

      const expenses = accounts.filter((a: any) => a.type === 'expense').map((a: any) => {
        const p = from ? (periodMap[a.id] || { debit: 0, credit: 0 }) : (cumulativeMap[a.id] || { debit: 0, credit: 0 });
        return { id: a.id, code: a.code, name: a.name, amount: Math.max(0, p.debit - p.credit) };
      }).filter(e => e.amount > 0).sort((a, b) => a.code.localeCompare(b.code));

      const totalRevenue = revenue.reduce((s, r) => s + r.amount, 0);
      const totalExpenses = expenses.reduce((s, r) => s + r.amount, 0);
      const netIncome = totalRevenue - totalExpenses;

      return success({ 
        revenue, 
        expenses, 
        total_revenue: totalRevenue, 
        total_expenses: totalExpenses, 
        net_income: netIncome 
      });
    }

    // ==========================================
    // 3. الميزانية العمومية (Balance Sheet)
    // ==========================================
    if (type === 'balance_sheet') {
      // Balance sheet is cumulative point-in-time as of `to` date
      const assets = accounts.filter((a: any) => a.type === 'asset').map((a: any) => {
        const c = cumulativeMap[a.id] || { debit: 0, credit: 0 };
        return { id: a.id, code: a.code, name: a.name, balance: c.debit - c.credit };
      }).filter(a => a.balance !== 0).sort((a, b) => a.code.localeCompare(b.code));

      const liabilities = accounts.filter((a: any) => a.type === 'liability').map((a: any) => {
        const c = cumulativeMap[a.id] || { debit: 0, credit: 0 };
        return { id: a.id, code: a.code, name: a.name, balance: c.credit - c.debit };
      }).filter(l => l.balance !== 0).sort((a, b) => a.code.localeCompare(b.code));

      const equity = accounts.filter((a: any) => a.type === 'equity').map((a: any) => {
        const c = cumulativeMap[a.id] || { debit: 0, credit: 0 };
        return { id: a.id, code: a.code, name: a.name, balance: c.credit - c.debit };
      }).filter(e => e.balance !== 0).sort((a, b) => a.code.localeCompare(b.code));

      // Calculate cumulative net income from revenue & expenses up to `to` date
      const cumulativeRevenue = accounts.filter((a: any) => a.type === 'revenue').reduce((sum, a) => {
        const c = cumulativeMap[a.id] || { debit: 0, credit: 0 };
        return sum + (c.credit - c.debit);
      }, 0);
      
      const cumulativeExpenses = accounts.filter((a: any) => a.type === 'expense').reduce((sum, a) => {
        const c = cumulativeMap[a.id] || { debit: 0, credit: 0 };
        return sum + (c.debit - c.credit);
      }, 0);
      
      const currentYearNetIncome = cumulativeRevenue - cumulativeExpenses;

      // Add current period earnings to equity
      const equityWithNetIncome = [
        ...equity,
        {
          id: 'virtual-current-year-net-income',
          code: '3300-V',
          name: 'أرباح (خسائر) الفترة الحالية (من قائمة الدخل)',
          balance: currentYearNetIncome
        }
      ];

      const totalAssets = assets.reduce((s, r) => s + r.balance, 0);
      const totalLiabilities = liabilities.reduce((s, r) => s + r.balance, 0);
      const totalEquity = equityWithNetIncome.reduce((s, r) => s + r.balance, 0);

      return success({ 
        assets, 
        liabilities, 
        equity: equityWithNetIncome, 
        total_assets: totalAssets, 
        total_liabilities: totalLiabilities, 
        total_equity: totalEquity 
      });
    }

    return error('Invalid report type');
  } catch (err) {
    return handleApiError(err);
  }
}
