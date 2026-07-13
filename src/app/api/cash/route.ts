import { NextRequest } from 'next/server';
import { success, error, parseBody, getPaginationParams, requireApiAuth, handleApiError } from '@/lib/api-helpers';
import { getSupabase } from '@/lib/supabase-client';
import { generateId } from '@/lib/utils';

const sb = () => getSupabase();

export async function GET(request: NextRequest) {
  try {
    const auth = await requireApiAuth(request);
    const s = sb();
    const url = new URL(request.url);
    const { page, pageSize } = getPaginationParams(url);
    const dateFrom = url.searchParams.get('date_from');
    const dateTo = url.searchParams.get('date_to');
    const type = url.searchParams.get('type');
    const accountId = url.searchParams.get('account_id');
    const contactId = url.searchParams.get('contact_id');

    let query = s.from('cash_transactions')
      .select('*, banks_safes(name), accounts(name), contacts(name), journal_entries(number)', { count: 'exact' })
      .eq('company_id', auth.companyId);

    if (dateFrom) query = query.gte('date', dateFrom);
    if (dateTo) query = query.lte('date', dateTo);
    if (type) query = query.eq('type', type);
    if (accountId) query = query.eq('account_id', accountId);
    if (contactId) query = query.eq('contact_id', contactId);

    const offset = (page - 1) * pageSize;
    const { data, error: queryError, count } = await query
      .order('created_at', { ascending: false })
      .range(offset, offset + pageSize - 1);

    if (queryError) throw queryError;

    const rows = (data || []).map((ct: any) => ({
      ...ct,
      bank_safe_name: ct.banks_safes?.name || null,
      account_name: ct.accounts?.name || null,
      contact_name: ct.contacts?.name || null,
      journal_entry_number: ct.journal_entries?.number || null,
    }));

    return success({
      rows,
      total: count || 0,
      page,
      pageSize,
      totalPages: Math.ceil((count || 0) / pageSize),
    });
  } catch (err) {
    return handleApiError(err);
  }
}

export async function POST(request: NextRequest) {
  try {
    const auth = await requireApiAuth(request);
    const s = sb();
    const body = await parseBody<{
      date: string;
      type: string;
      amount: number;
      account_id: string;
      bank_safe_id?: string | null;
      contact_id?: string | null;
      project_id?: string | null;
      category_id?: string | null;
      reason: string;
    }>(request);

    if (!body.date || !body.type || !body.amount || !body.account_id || !body.reason) {
      return error('جميع الحقول المطلوبة يجب أن تكون مدخلة');
    }
    if (body.amount <= 0) {
      return error('المبلغ يجب أن يكون أكبر من صفر');
    }

    const txId = generateId();
    const jeId = generateId();

    // Get next journal entry number
    const { data: maxJe } = await s.from('journal_entries')
      .select('number')
      .eq('company_id', auth.companyId)
      .order('number', { ascending: false })
      .limit(1)
      .maybeSingle();
    const nextSeq = ((maxJe as any)?.number || 0) + 1;

    let bankAccountId: string | null = null;
    if (body.bank_safe_id) {
      const { data: bank } = await s.from('banks_safes')
        .select('account_id')
        .eq('id', body.bank_safe_id)
        .eq('company_id', auth.companyId)
        .maybeSingle();
      if (!bank || !bank.account_id) {
        return error('الخزينة/البنك غير موجود');
      }
      bankAccountId = bank.account_id;
    }

    const desc = `${body.type === 'receipt' ? 'قبض' : 'صرف'}: ${body.reason}`;

    const { error: jeError } = await s.from('journal_entries')
      .insert({
        id: jeId,
        company_id: auth.companyId,
        number: nextSeq,
        date: body.date,
        type: 'cash',
        description: desc,
        project_id: body.project_id || null,
        created_by: auth.userId,
      });
    if (jeError) throw jeError;

    if (body.type === 'receipt') {
      const { error: l1Err } = await s.from('journal_lines').insert({
        id: generateId(),
        journal_entry_id: jeId,
        account_id: bankAccountId || body.account_id,
        debit: body.amount,
        credit: 0,
        description: body.reason,
        project_id: body.project_id || null,
        contact_id: body.contact_id || null,
      });
      if (l1Err) throw l1Err;

      const { error: l2Err } = await s.from('journal_lines').insert({
        id: generateId(),
        journal_entry_id: jeId,
        account_id: body.account_id,
        debit: 0,
        credit: body.amount,
        description: body.reason,
        project_id: body.project_id || null,
        contact_id: body.contact_id || null,
      });
      if (l2Err) throw l2Err;
    } else {
      const { error: l1Err } = await s.from('journal_lines').insert({
        id: generateId(),
        journal_entry_id: jeId,
        account_id: body.account_id,
        debit: body.amount,
        credit: 0,
        description: body.reason,
        project_id: body.project_id || null,
        contact_id: body.contact_id || null,
      });
      if (l1Err) throw l1Err;

      const { error: l2Err } = await s.from('journal_lines').insert({
        id: generateId(),
        journal_entry_id: jeId,
        account_id: bankAccountId || body.account_id,
        debit: 0,
        credit: body.amount,
        description: body.reason,
        project_id: body.project_id || null,
        contact_id: body.contact_id || null,
      });
      if (l2Err) throw l2Err;
    }

    const { data: txData, error: txError } = await s.from('cash_transactions')
      .insert({
        id: txId,
        company_id: auth.companyId,
        date: body.date,
        type: body.type,
        amount: body.amount,
        account_id: body.account_id,
        bank_safe_id: body.bank_safe_id || null,
        contact_id: body.contact_id || null,
        project_id: body.project_id || null,
        category_id: body.category_id || null,
        reason: body.reason,
        journal_entry_id: jeId,
        created_by: auth.userId,
      })
      .select('*, journal_entries(number)')
      .single();

    if (txError) throw txError;

    const result: any = txData;
    return success({
      ...result,
      journal_entry_number: result.journal_entries?.number || null,
    }, 201);
  } catch (err) {
    return handleApiError(err);
  }
}
