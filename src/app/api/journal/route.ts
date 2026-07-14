import { NextRequest } from 'next/server';
import { success, error, parseBody, requireApiAuth, handleApiError } from '@/lib/api-helpers';
import { getSupabase } from '@/lib/supabase-client';
import { journalEntrySchema } from '@/lib/validation';

const sb = () => getSupabase();

export async function GET(request: NextRequest) {
  try {
    const auth = await requireApiAuth(request);
    const s = sb();
    const url = request.nextUrl;
    const page = Math.max(1, parseInt(url.searchParams.get('page') || '1', 10) || 1);
    const pageSize = Math.min(500, Math.max(1, parseInt(url.searchParams.get('pageSize') || '50', 10) || 50));
    const dateFrom = url.searchParams.get('date_from') || url.searchParams.get('from');
    const dateTo = url.searchParams.get('date_to') || url.searchParams.get('to');
    const type = url.searchParams.get('type');
    const accountId = url.searchParams.get('account_id');

    let query = s.from('journal_entries')
      .select('id, number, date, type, description, created_by, created_at', { count: 'exact' })
      .eq('company_id', auth.companyId);

    if (dateFrom) query = query.gte('date', dateFrom);
    if (dateTo) query = query.lte('date', dateTo);
    if (type) query = query.eq('type', type);

    const offset = (page - 1) * pageSize;
    const { data: entries, error: queryError, count } = await query
      .order('date', { ascending: false })
      .order('number', { ascending: false })
      .range(offset, offset + pageSize - 1);

    if (queryError) throw queryError;

    // FIXED: N+1 query - batch fetch all lines at once
    let enriched = entries || [];
    if (accountId) {
      const { data: acc } = await s.from('accounts').select('id').eq('id', accountId).eq('company_id', auth.companyId).maybeSingle();
      if (acc) {
        const { data: filteredLines } = await s.from('journal_lines')
          .select('journal_entry_id').eq('account_id', acc.id);
        const jeIds = new Set((filteredLines || []).map((l: any) => l.journal_entry_id));
        enriched = (entries || []).filter((e: any) => jeIds.has(e.id));
      } else {
        enriched = [];
      }
    }

    // Batch fetch all lines for all entries
    const enrichedIds = enriched.map((e: any) => e.id);
    const linesMap: Record<string, { count: number; total_debit: number; total_credit: number }> = {};
    if (enrichedIds.length > 0) {
      const { data: allLines } = await s.from('journal_lines')
        .select('journal_entry_id, debit, credit')
        .in('journal_entry_id', enrichedIds);
      
      for (const line of allLines || []) {
        const jeId = (line as any).journal_entry_id;
        if (!linesMap[jeId]) linesMap[jeId] = { count: 0, total_debit: 0, total_credit: 0 };
        linesMap[jeId].count += 1;
        linesMap[jeId].total_debit += parseFloat((line as any).debit) || 0;
        linesMap[jeId].total_credit += parseFloat((line as any).credit) || 0;
      }
    }

    const result = enriched.map((entry: any) => {
      const summary = linesMap[entry.id] || { count: 0, total_debit: 0, total_credit: 0 };
      return {
        ...entry,
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
    const auth = await requireApiAuth(request);
    const s = sb();
    const body = await parseBody(request);
    const parsed = journalEntrySchema.safeParse(body);
    if (!parsed.success) return error(parsed.error.issues[0].message);

    const { date, type, description, reference, lines } = parsed.data;

    // SECURITY FIX: Try atomic RPC function first (validates balance BEFORE inserting)
    // This eliminates the need for manual rollback and prevents the race condition window
    // where an unbalanced entry could be read by another query.
    try {
      // Resolve account IDs for all lines first
      const resolvedLines: any[] = [];
      for (const line of lines) {
        const { data: account } = await s.from('accounts')
          .select('id').eq('company_id', auth.companyId).eq('code', line.accountCode).maybeSingle();
        if (!account) throw new Error(`الحساب برمز ${line.accountCode} غير موجود`);
        resolvedLines.push({
          accountId: account.id,
          accountCode: line.accountCode,
          debit: line.debit,
          credit: line.credit,
          description: line.description || null,
          contactId: null,
          projectId: null,
        });
      }

      const { data: rpcResult, error: rpcError } = await s.rpc('create_journal_entry', {
        p_company_id: auth.companyId,
        p_date: date,
        p_type: type,
        p_description: description || null,
        p_created_by: auth.userId,
        p_lines: resolvedLines,
      });

      if (rpcError) throw rpcError;

      const result: any = rpcResult;
      const entryId = result.id;

      // Fetch the created entry and lines for response
      const { data: entryRes } = await s.from('journal_entries')
        .select('id, number, date, type, description, created_at')
        .eq('id', entryId).single();

      const { data: linesRes } = await s.from('journal_lines')
        .select('id, account_code, accounts(name, type), debit, credit, description')
        .eq('journal_entry_id', entryId).order('id');

      const formattedLines = (linesRes || []).map((l: any) => ({
        id: l.id, account_code: l.account_code,
        account_name: (l.accounts as any)?.name || null,
        account_type: (l.accounts as any)?.type || null,
        debit: l.debit, credit: l.credit, description: l.description,
      }));

      return success({
        ...entryRes,
        totalDebit: result.total_debit,
        totalCredit: result.total_credit,
        lines: formattedLines,
      }, 201);
    } catch (rpcAttempt: any) {
      // If the RPC function doesn't exist yet (migration not applied), fall through to legacy logic
      if (rpcAttempt.message?.includes('غير موجود')) throw rpcAttempt;
      if (rpcAttempt.message?.includes('الموازنة') || rpcAttempt.code === 'P0001') {
        return error(rpcAttempt.message);
      }
      // RPC function not found - fall through to legacy logic below
      if (!rpcAttempt.message?.includes('function') && !rpcAttempt.message?.includes('does not exist') && !rpcAttempt.message?.includes('Could not find')) {
        throw rpcAttempt;
      }
    }

    // LEGACY FALLBACK: Used only when create_journal_entry RPC function doesn't exist yet
    // This has the known issue of manual rollback - will be removed after migration 012 is applied
    const year = date.substring(0, 4);

    let number: number;
    try {
      const { data: rpcData, error: rpcError } = await s.rpc('next_journal_number', {
        p_company_id: auth.companyId,
        p_year: parseInt(year),
      });
      if (rpcError || rpcData == null) throw rpcError || new Error('RPC failed');
      number = rpcData as number;
    } catch {
      const { data: seqExisting } = await s.from('journal_sequences')
        .select('last_number').eq('company_id', auth.companyId).eq('year', year).maybeSingle();
      if (seqExisting) {
        number = seqExisting.last_number + 1;
        const { error: seqErr } = await s.from('journal_sequences')
          .update({ last_number: number }).eq('company_id', auth.companyId).eq('year', year);
        if (seqErr) throw seqErr;
      } else {
        number = 1;
        const { error: seqErr } = await s.from('journal_sequences')
          .insert({ company_id: auth.companyId, year: parseInt(year), last_number: 1 });
        if (seqErr) throw seqErr;
      }
    }

    // SECURITY NOTE: Pre-validate balance BEFORE inserting to avoid manual rollback window
    let preCheckDebit = 0;
    let preCheckCredit = 0;
    for (const line of lines) {
      preCheckDebit += line.debit;
      preCheckCredit += line.credit;
    }
    if (Math.abs(preCheckDebit - preCheckCredit) > 0.01) {
      return error(`خطأ في الموازنة: مجموع الديون (${preCheckDebit}) لا يساوي مجموع الدائنين (${preCheckCredit})`);
    }

    const { data: entryRes, error: entryErr } = await s.from('journal_entries')
      .insert({
        company_id: auth.companyId, number, date, type,
        description: description || null, created_by: auth.userId,
      })
      .select('id, number, date, type, description, created_at')
      .single();

    if (entryErr) {
      try {
        const { data: fallback } = await s.from('journal_entries')
          .insert({
            company_id: auth.companyId, number, date, type,
            description: description || null,
          })
          .select('id, number, date, type, description, created_at')
          .single();
        if (fallback) {
          const entryId = fallback.id;
          let totalDebit = 0;
          let totalCredit = 0;
          for (const line of lines) {
            const { data: account } = await s.from('accounts')
              .select('id').eq('company_id', auth.companyId).eq('code', line.accountCode).maybeSingle();
            if (!account) throw new Error(`الحساب برمز ${line.accountCode} غير موجود`);
            const { error: lineErr } = await s.from('journal_lines').insert({
              journal_entry_id: entryId, account_id: account.id, account_code: line.accountCode,
              debit: line.debit, credit: line.credit, description: line.description || null,
            });
            if (lineErr) throw lineErr;
            totalDebit += line.debit;
            totalCredit += line.credit;
          }
          const { data: linesRes } = await s.from('journal_lines')
            .select('id, account_code, accounts(name, type), debit, credit, description')
            .eq('journal_entry_id', entryId).order('id');
          const formattedLines = (linesRes || []).map((l: any) => ({
            id: l.id, account_code: l.account_code, account_name: (l.accounts as any)?.name || null,
            account_type: (l.accounts as any)?.type || null, debit: l.debit, credit: l.credit, description: l.description,
          }));
          return success({ ...fallback, totalDebit, totalCredit, lines: formattedLines }, 201);
        }
      } catch {}
      throw entryErr;
    }

    const entryId = entryRes.id;
    let totalDebit = 0;
    let totalCredit = 0;
    for (const line of lines) {
      const { data: account } = await s.from('accounts')
        .select('id').eq('company_id', auth.companyId).eq('code', line.accountCode).maybeSingle();
      if (!account) throw new Error(`الحساب برمز ${line.accountCode} غير موجود`);
      const { error: lineErr } = await s.from('journal_lines').insert({
        journal_entry_id: entryId, account_id: account.id, account_code: line.accountCode,
        debit: line.debit, credit: line.credit, description: line.description || null,
      });
      if (lineErr) throw lineErr;
      totalDebit += line.debit;
      totalCredit += line.credit;
    }

    const { data: linesRes } = await s.from('journal_lines')
      .select('id, account_code, accounts(name, type), debit, credit, description')
      .eq('journal_entry_id', entryId).order('id');

    const formattedLines = (linesRes || []).map((l: any) => ({
      id: l.id, account_code: l.account_code, account_name: (l.accounts as any)?.name || null,
      account_type: (l.accounts as any)?.type || null, debit: l.debit, credit: l.credit, description: l.description,
    }));

    return success({ ...entryRes, totalDebit, totalCredit, lines: formattedLines }, 201);
  } catch (err: any) {
    if (err.message?.includes('غير موجود') || err.message?.includes('الموازنة')) return error(err.message);
    return handleApiError(err);
  }
}
