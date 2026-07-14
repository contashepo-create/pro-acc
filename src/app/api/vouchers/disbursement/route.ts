import { NextRequest } from 'next/server';
import { success, error, parseBody, getPaginationParams, getDateRangeParams, requireApiAuth, handleApiError } from '@/lib/api-helpers';
import { getSupabase } from '@/lib/supabase-client';
import { getNextVoucherNumber, getNextJournalNumber } from '@/lib/numbering';
import { ACCOUNT_CODES } from '@/lib/constants';

const sb = () => getSupabase();

export async function GET(request: NextRequest) {
  try {
    const auth = await requireApiAuth(request);
    const s = sb();
    const url = new URL(request.url);
    const { page, pageSize } = getPaginationParams(url);
    const { from, to } = getDateRangeParams(url);
    const disbType = url.searchParams.get('disbursementType');

    let query = s.from('voucher_disbursements')
      .select('*, contacts(name), employees(name), banks_safes(name), journal_entries(number)', { count: 'exact' })
      .eq('company_id', auth.companyId);
    if (from) query = query.gte('date', from);
    if (to) query = query.lte('date', to);
    if (disbType) query = query.eq('disbursement_type', disbType);

    const offset = (page - 1) * pageSize;
    const { data, error: queryError, count } = await query
      .order('date', { ascending: false }).order('number', { ascending: false })
      .range(offset, offset + pageSize - 1);

    if (queryError) throw queryError;

    const disbursements = (data || []).map((vd: any) => ({
      ...vd, contact_name: vd.contacts?.name || null, employee_name: vd.employees?.name || null,
      bank_name: vd.banks_safes?.name || null, journal_entry_number: vd.journal_entries?.number || null,
    }));

    return success({ disbursements, total: count || 0, page, pageSize });
  } catch (err) {
    return handleApiError(err);
  }
}

export async function POST(request: NextRequest) {
  try {
    const auth = await requireApiAuth(request);
    const s = sb();
    const data = await parseBody(request);
    const { date, disbursement_type, contact_id, employee_id, amount, bank_safe_id, reason, invoice_items, account_id } = data;

    if (!date || !disbursement_type || !amount || !bank_safe_id || !reason)
      return error('date, disbursement_type, amount, bank_safe_id, reason are required');

    const companyId = auth.companyId;
    const userId = auth.userId;

    const nextNum = await getNextVoucherNumber(companyId, 'voucher_disbursements');

    const { data: bankAcc } = await s.from('banks_safes').select('account_id').eq('id', bank_safe_id).maybeSingle();
    // FIXED: Use atomic RPC-based numbering instead of manual MAX+1
    const jeNum = await getNextJournalNumber(companyId, date);
    const { data: je } = await s.from('journal_entries')
      .insert({ company_id: companyId, number: jeNum, date, type: 'general', description: `سند صرف: ${reason}`, created_by: userId })
      .select('id').single();
    const jeId = je.id;

    const jl: any[] = [];
    if (bankAcc?.account_id) jl.push({ journal_entry_id: jeId, account_id: bankAcc.account_id, debit: 0, credit: amount });

    if (disbursement_type === 'supplier' || disbursement_type === 'supplier_advance') {
      const { data: apAcc } = await s.from('accounts').select('id').eq('company_id', companyId).eq('code', ACCOUNT_CODES.ACCOUNTS_PAYABLE).maybeSingle();
      if (apAcc) jl.push({ journal_entry_id: jeId, account_id: apAcc.id, debit: amount, credit: 0 });
    } else if (disbursement_type === 'client_refund') {
      const { data: arAcc } = await s.from('accounts').select('id').eq('company_id', companyId).eq('code', ACCOUNT_CODES.ACCOUNTS_RECEIVABLE).maybeSingle();
      if (arAcc) jl.push({ journal_entry_id: jeId, account_id: arAcc.id, debit: amount, credit: 0 });
    } else if (disbursement_type === 'employee_advance') {
      const { data: advAcc } = await s.from('accounts').select('id').eq('company_id', companyId).eq('code', ACCOUNT_CODES.EMPLOYEE_ADVANCES).maybeSingle();
      if (advAcc) jl.push({ journal_entry_id: jeId, account_id: advAcc.id, debit: amount, credit: 0 });
      if (employee_id) {
        await s.from('employee_advances').insert({ company_id: companyId, employee_id, date, type: 'advance', amount, description: reason });
      }
    } else if (disbursement_type === 'subcontractor') {
      const { data: subAcc } = await s.from('accounts').select('id').eq('company_id', companyId).eq('code', ACCOUNT_CODES.SUBCONTRACTOR_PAYABLES).maybeSingle();
      if (subAcc) jl.push({ journal_entry_id: jeId, account_id: subAcc.id, debit: amount, credit: 0 });
    } else {
      if (account_id) jl.push({ journal_entry_id: jeId, account_id: account_id, debit: amount, credit: 0 });
    }
    if (jl.length > 0) await s.from('journal_lines').insert(jl);

    if (disbursement_type === 'supplier' && invoice_items && invoice_items.length > 0) {
      for (const item of invoice_items) {
        await s.from('disbursement_invoice_items').insert({ disbursement_voucher_id: nextNum, purchase_invoice_id: item.purchase_invoice_id, amount: item.amount });
      }
    }

    const { data: vd, error: vdErr } = await s.from('voucher_disbursements')
      .insert({ company_id: companyId, number: nextNum, date, disbursement_type, contact_id: contact_id || null, employee_id: employee_id || null, amount, bank_safe_id, reason, journal_entry_id: jeId, created_by: userId })
      .select('*').single();
    if (vdErr) throw vdErr;
    return success(vd, 201);
  } catch (err) {
    return handleApiError(err);
  }
}

export async function DELETE(request: NextRequest) {
  try {
    const auth = await requireApiAuth(request);
    const s = sb();
    const url = new URL(request.url);
    const id = url.searchParams.get('id');
    if (!id) return error('id is required');

    const { data: vd } = await s.from('voucher_disbursements')
      .select('*').eq('id', id).eq('company_id', auth.companyId).maybeSingle();
    if (!vd) return error('سند الصرف غير موجود');

    if (vd.journal_entry_id) {
      await s.from('journal_lines').delete().eq('journal_entry_id', vd.journal_entry_id);
      await s.from('journal_entries').delete().eq('id', vd.journal_entry_id);
    }
    if (vd.employee_id && vd.disbursement_type === 'employee_advance') {
      const { data: adv } = await s.from('employee_advances')
        .select('id').eq('employee_id', vd.employee_id).eq('amount', vd.amount).eq('type', 'advance').limit(1).maybeSingle();
      if (adv) await s.from('employee_advances').delete().eq('id', adv.id);
    }
    await s.from('voucher_disbursements').delete().eq('id', id);
    return success({ deleted: true });
  } catch (err) {
    return handleApiError(err);
  }
}
