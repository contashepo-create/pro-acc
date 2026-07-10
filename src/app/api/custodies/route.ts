import { NextRequest } from 'next/server';
import { success, error, parseBody, getPaginationParams, getDateRangeParams, requireApiAuth, handleApiError } from '@/lib/api-helpers';
import { getSupabase } from '@/lib/supabase-client';
import { getNextJournalNumber, getNextVoucherNumber } from '@/lib/numbering';
import { ACCOUNT_CODES } from '@/lib/constants';

// @ts-ignore
const sb = () => getSupabase() as any;

export async function GET(req: NextRequest) {
  try {
    const auth = await requireApiAuth(req);
    const s = sb();
    const url = new URL(req.url);
    const { page, pageSize } = getPaginationParams(url);
    const { from, to } = getDateRangeParams(url);
    const employeeId = url.searchParams.get('employeeId');

    let query = s.from('custodies')
      .select('*, employees(name), banks_safes(name)', { count: 'exact' }).eq('company_id', auth.companyId);
    if (from) query = query.gte('date', from);
    if (to) query = query.lte('date', to);
    if (employeeId) query = query.eq('employee_id', employeeId);

    const offset = (page - 1) * pageSize;
    const { data, error: queryError, count } = await query
      .order('date', { ascending: false }).range(offset, offset + pageSize - 1);
    if (queryError) throw queryError;

    const custodies = (data || []).map((c: any) => ({
      ...c, employee_name: c.employees?.name || null, bank_name: c.banks_safes?.name || null,
    }));
    return success({ custodies, total: count || 0, page, pageSize });
  } catch (err) { return handleApiError(err); }
}

export async function POST(req: NextRequest) {
  try {
    const auth = await requireApiAuth(req);
    const s = sb();
    const data = await parseBody(req);
    const { employee_id, date, amount, bank_safe_id, description } = data;
    if (!employee_id || !date || !amount || !bank_safe_id)
      return error('employee_id, date, amount, bank_safe_id are required');

    const { data: custody, error: cErr } = await s.from('custodies')
      .insert({ company_id: auth.companyId, employee_id, date, amount, bank_safe_id, description, status: 'open', created_by: auth.userId })
      .select('*').single();
    if (cErr) throw cErr;

    const { data: custAcc } = await s.from('accounts').select('id').eq('company_id', auth.companyId).eq('code', ACCOUNT_CODES.EMPLOYEE_CUSTODIES).maybeSingle();
    const { data: bankAcc } = await s.from('banks_safes').select('account_id').eq('id', bank_safe_id).maybeSingle();

    if (custAcc && bankAcc?.account_id) {
      const jeNum = await getNextJournalNumber(companyId, date || new Date().toISOString());
      const { data: je } = await s.from('journal_entries')
        .insert({ company_id: auth.companyId, number: jeNum, date, type: 'general', description: `عهدة: ${description || ''}`, created_by: auth.userId })
        .select('id').single();
      await s.from('journal_lines').insert([
        { journal_entry_id: je.id, account_id: custAcc.id, debit: amount, credit: 0 },
        { journal_entry_id: je.id, account_id: bankAcc.account_id, debit: 0, credit: amount },
      ]);
    }
    return success(custody, 201);
  } catch (err) { return handleApiError(err); }
}
