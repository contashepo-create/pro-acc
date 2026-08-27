import { NextRequest } from 'next/server';
import { success, error, parseBody, requireModulePermission, handleApiError } from '@/lib/api-helpers';
import { getSupabase } from '@/lib/supabase-client';
import { journalEntrySchema } from '@/lib/validation';

import type { Row } from '@/lib/types';


const sb = () => getSupabase();

// Type definitions for Supabase query results
interface JournalEntry { id: string; number: number; date: string; type: string; description: string; created_by: string; created_at: string }
interface JournalLine { journal_entry_id: string; account_id: string; account_code: string; debit: number; credit: number; description: string }
interface RpcResult { id: string; number: number; total_debit: number; total_credit: number; lines_count: number }

export async function GET(request: NextRequest) {
  try {
    const auth = await requireModulePermission(request, 'journal', 'read');
    const s = sb();
    const url = request.nextUrl;
    const page = Math.max(1, parseInt(url.searchParams.get('page') || '1', 10) || 1);
    const pageSize = Math.min(500, Math.max(1, parseInt(url.searchParams.get('pageSize') || '50', 10) || 50));
    const dateFrom = url.searchParams.get('date_from') || url.searchParams.get('from');
    const dateTo = url.searchParams.get('date_to') || url.searchParams.get('to');
    const type = url.searchParams.get('type');
    const accountId = url.searchParams.get('account_id');
    if ((dateFrom && !/^\d{4}-\d{2}-\d{2}$/.test(dateFrom)) || (dateTo && !/^\d{4}-\d{2}-\d{2}$/.test(dateTo)) || (dateFrom && dateTo && dateFrom > dateTo)) return error('فترة القيود غير صالحة');
    if (type && !['general', 'opening_balance', 'accrual'].includes(type)) return error('نوع القيد غير صالح');

    if (accountId) {
      const { data: account } = await s.from('accounts').select('id')
        .eq('id', accountId).eq('company_id', auth.companyId).maybeSingle();
      if (!account) return error('الحساب غير موجود', 404);
    }
    const entrySelect = accountId
      ? 'id, number, date, type, description, created_by, created_at, journal_lines!inner(account_id)'
      : 'id, number, date, type, description, created_by, created_at';
    let query = s.from('journal_entries')
      .select(entrySelect, { count: 'exact' })
      .eq('company_id', auth.companyId);
    if (accountId) query = query.eq('journal_lines.account_id', accountId);

    if (dateFrom) query = query.gte('date', dateFrom);
    if (dateTo) query = query.lte('date', dateTo);
    if (type) query = query.eq('type', type);

    const offset = (page - 1) * pageSize;
    const { data: entries, error: queryError, count } = await query
      .order('date', { ascending: false })
      .order('number', { ascending: false })
      .range(offset, offset + pageSize - 1);

    if (queryError) throw queryError;

    const enriched = entries || [];
    const enrichedIds = enriched.map((entry: Row) => entry.id);
    const linesMap: Record<string, { count: number; total_debit: number; total_credit: number }> = {};
    if (enrichedIds.length > 0) {
      const { data: allLines, error: linesError } = await s.from('journal_lines')
        .select('journal_entry_id, debit, credit')
        .in('journal_entry_id', enrichedIds)
        .eq('company_id', auth.companyId);
      if (linesError) throw linesError;
      
      for (const line of allLines || []) {
        const jeId = String((line as unknown as JournalLine).journal_entry_id);
        if (!linesMap[jeId]) linesMap[jeId] = { count: 0, total_debit: 0, total_credit: 0 };
        linesMap[jeId].count += 1;
        linesMap[jeId].total_debit += Number((line as unknown as JournalLine).debit) || 0;
        linesMap[jeId].total_credit += Number((line as unknown as JournalLine).credit) || 0;
      }
    }

    const result = enriched.map((entry) => {
      const e = entry as unknown as JournalEntry;
      const summary = linesMap[e.id] || { count: 0, total_debit: 0, total_credit: 0 };
      return {
        ...e,
        lines_count: summary.count,
        total_debit: summary.total_debit,
        total_credit: summary.total_credit,
      };
    });

    return success({ entries: result, total: count || 0, page, pageSize, totalPages: Math.ceil((count || 0) / pageSize) || 1 });
  } catch (err) {
    return handleApiError(err);
  }
}

export async function POST(request: NextRequest) {
  try {
    const auth = await requireModulePermission(request, 'journal', 'create');
    const s = sb();
    const body = await parseBody(request);
    const parsed = journalEntrySchema.safeParse(body);
    if (!parsed.success) return error(parsed.error.issues[0].message);
    const { date, type, description, lines } = parsed.data;

    const { data: existingAccounts, error: accountProbeError } = await s.from('accounts')
      .select('id').eq('company_id', auth.companyId).limit(1);
    if (accountProbeError) throw accountProbeError;
    if (!existingAccounts?.length) {
      const { createDefaultChartOfAccounts } = await import('@/lib/default-accounts');
      await createDefaultChartOfAccounts(s, auth.companyId);
    }

    const { isHeaderAccount } = await import('@/lib/account-resolve');
    const { findAccountByCode } = await import('@/lib/account-code');
    const resolvedLines: Array<{
      accountId: string; debit: number; credit: number; description: string | null; contactId: null; projectId: null;
    }> = [];
    for (const line of lines) {
      const account = await findAccountByCode(s, auth.companyId, line.accountCode);
      if (!account) return error(`الحساب برمز ${line.accountCode} غير موجود`);
      if (isHeaderAccount(account)) return error(`الحساب ${account.code} حساب رئيسي ولا يُرحّل عليه`);
      resolvedLines.push({
        accountId: account.id, debit: line.debit, credit: line.credit,
        description: line.description || null, contactId: null, projectId: null,
      });
    }
    const { data: rpcResult, error: rpcError } = await s.rpc('create_journal_entry', {
      p_company_id: auth.companyId, p_date: date, p_type: type,
      p_description: description || null, p_created_by: auth.userId, p_lines: resolvedLines,
    });
    if (rpcError) {
      if (rpcError.code === 'P0001' || /القيد|الحساب|الموازنة|السنة المالية|closed fiscal/i.test(rpcError.message || '')) {
        return error(rpcError.message || 'تعذر ترحيل القيد', 409);
      }
      throw rpcError;
    }
    const result = rpcResult as RpcResult;
    const { data: entry, error: entryError } = await s.from('journal_entries')
      .select('id, number, date, type, description, created_at')
      .eq('id', result.id).eq('company_id', auth.companyId).maybeSingle();
    if (entryError || !entry) throw entryError || new Error('تعذر قراءة القيد المرحّل');
    const { data: createdLines, error: linesError } = await s.from('journal_lines')
      .select('id, account_code, accounts(name, type), debit, credit, description')
      .eq('journal_entry_id', result.id).eq('company_id', auth.companyId).order('id');
    if (linesError) throw linesError;
    const formattedLines = (createdLines || []).map((line: Record<string, unknown>) => ({
      id: line.id, account_code: line.account_code, account_name: line.accounts ? String((line.accounts as Row).name) || null : null,
      account_type: line.accounts ? String((line.accounts as Row).type) || null : null, debit: line.debit, credit: line.credit, description: line.description,
    }));
    try {
      const { logAudit } = await import('@/lib/audit');
      await logAudit({
        company_id: auth.companyId, user_id: auth.userId, entity_type: 'journal_entry',
        entity_id: result.id, action: 'create', after: { id: result.id, date, type, totalDebit: result.total_debit, totalCredit: result.total_credit },
        summary: `إنشاء قيد يومي (مدين ${result.total_debit} / دائن ${result.total_credit})`,
      });
    } catch (auditError) {
      console.error('Journal audit write failed after posting:', auditError);
    }
    return success({
      ...entry, totalDebit: result.total_debit, totalCredit: result.total_credit, lines: formattedLines,
    }, 201);
  } catch (err) {
    return handleApiError(err);
  }
}
