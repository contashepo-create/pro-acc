import { NextRequest } from 'next/server';
import { success, error, parseBody, getPaginationParams, getDateRangeParams, requireApiAuth, handleApiError, requireManagerOrAbove } from '@/lib/api-helpers';
// RBAC import added
import { getSupabase } from '@/lib/supabase-client';
import { ACCOUNT_CODES } from '@/lib/constants';
import { getNextJournalNumber } from '@/lib/numbering';

const sb = () => getSupabase();

export async function GET(request: NextRequest) {
  try {
    const auth = await requireApiAuth(request);
    const s = sb();
    const url = new URL(request.url);
    const { page, pageSize } = getPaginationParams(url);
    const { from, to } = getDateRangeParams(url);
    const receiptType = url.searchParams.get('receiptType');

    let data, count, queryError;
    try {
      let query = s.from('voucher_receipts')
        .select('*, contacts(name), banks_safes(name), journal_entries(number)', { count: 'exact' })
        .eq('company_id', auth.companyId);
      if (from) query = query.gte('date', from);
      if (to) query = query.lte('date', to);
      if (receiptType) query = query.eq('receipt_type', receiptType);

      const offset = (page - 1) * pageSize;
      const result = await query
        .order('date', { ascending: false }).order('number', { ascending: false })
        .range(offset, offset + pageSize - 1);
      
      data = result.data;
      count = result.count;
      queryError = result.error;
    } catch (joinErr) {
      console.warn('Receipt GET with joins failed, fallback:', joinErr);
      let query = s.from('voucher_receipts')
        .select('*', { count: 'exact' })
        .eq('company_id', auth.companyId);
      if (from) query = query.gte('date', from);
      if (to) query = query.lte('date', to);
      if (receiptType) query = query.eq('receipt_type', receiptType);

      const offset = (page - 1) * pageSize;
      const result = await query
        .order('date', { ascending: false }).order('number', { ascending: false })
        .range(offset, offset + pageSize - 1);
      
      data = result.data;
      count = result.count;
      queryError = result.error;
    }

    if (queryError) throw queryError;

    const receipts = (data || []).map((vr: any) => ({
      ...vr, contact_name: vr.contacts?.name || null, bank_name: vr.banks_safes?.name || null,
      journal_entry_number: vr.journal_entries?.number || null,
    }));

    return success({ receipts, total: count || 0, page, pageSize });
  } catch (err) {
    console.error('Receipt GET error:', err);
    return success({ receipts: [], total: 0, page: 1, pageSize: 50 });
  }
}

export async function POST(request: NextRequest) {
  try {
    const auth = await requireApiAuth(request);
    const s = sb();
    const data = await parseBody(request);
    const { date, receipt_type, contact_id, amount, bank_safe_id, reason, reference_type, reference_id, invoice_items, account_id } = data;

    if (!date || !receipt_type || !amount || !bank_safe_id || !reason)
      return error('date, receipt_type, amount, bank_safe_id, reason are required');

    const companyId = auth.companyId;
    const userId = auth.userId;

    // FIXED: Use atomic RPC to avoid race condition
    let nextNum: number;
    try {
      const { data: rpcData } = await s.rpc('next_voucher_number', {
        p_company_id: companyId,
        p_table_name: 'voucher_receipts',
      });
      nextNum = rpcData as number;
    } catch {
      const { data: maxVr } = await s.from('voucher_receipts')
        .select('number').eq('company_id', companyId).order('number', { ascending: false }).limit(1).maybeSingle();
      nextNum = ((maxVr as any)?.number || 0) + 1;
    }

    // FIXED: getNextJournalNumber is now imported from @/lib/numbering (centralized atomic RPC)

    if (receipt_type === 'client') {
      let totalAllocated = 0;
      if (invoice_items && invoice_items.length > 0) {
        for (const item of invoice_items) {
          totalAllocated += parseFloat(item.amount) || 0;
          const { data: inv } = await s.from('invoices').select('id, total, number').eq('id', item.invoice_id).maybeSingle();
          if (!inv) throw new Error(`الفاتورة ${item.invoice_id} غير موجودة`);

          const { data: paidItems } = await s.from('receipt_invoice_items')
            .select('amount').eq('invoice_id', item.invoice_id);
          const paidSoFar = (paidItems || []).reduce((s: number, r: any) => s + (parseFloat(r.amount) || 0), 0);
          const newPaid = paidSoFar + parseFloat(item.amount);
          const total = parseFloat(inv.total);
          const newStatus = newPaid >= total ? 'paid' : 'partial';
          await s.from('invoices').update({ paid_amount: newPaid, status: newStatus }).eq('id', item.invoice_id);

          const { data: arAccount } = await s.from('accounts').select('id').eq('company_id', companyId).eq('code', ACCOUNT_CODES.ACCOUNTS_RECEIVABLE).maybeSingle();
          const { data: bankAccount } = await s.from('banks_safes').select('account_id').eq('id', bank_safe_id).maybeSingle();

          if (arAccount && bankAccount?.account_id) {
            const jeNum = await getNextJournalNumber(companyId, date);
            const { data: je } = await s.from('journal_entries')
              .insert({ company_id: companyId, number: jeNum, date, type: 'general', description: `دفع فاتورة #${inv.number}`, reference_type: 'invoice', reference_id: item.invoice_id, created_by: userId })
              .select('id').single();
            await s.from('journal_lines').insert([
              { journal_entry_id: je.id, account_id: bankAccount.account_id, debit: item.amount, credit: 0 },
              { journal_entry_id: je.id, account_id: arAccount.id, debit: 0, credit: item.amount },
            ]);
          }
        }
      }

      const { data: vr, error: vrErr } = await s.from('voucher_receipts')
        .insert({ company_id: companyId, number: nextNum, date, receipt_type, contact_id, amount: totalAllocated, bank_safe_id, reason, reference_type: reference_type || null, reference_id: reference_id || null, created_by: userId })
        .select('*').single();
      if (vrErr) throw vrErr;

      if (invoice_items && invoice_items.length > 0) {
        for (const item of invoice_items) {
          await s.from('receipt_invoice_items').insert({ voucher_receipt_id: vr.id, invoice_id: item.invoice_id, amount: item.amount });
        }
      }
      return success(vr, 201);
    }

    if (receipt_type === 'supplier_refund') {
      const { data: bankAccount } = await s.from('banks_safes').select('account_id').eq('id', bank_safe_id).maybeSingle();
      const { data: apAccount } = await s.from('accounts').select('id').eq('company_id', companyId).eq('code', ACCOUNT_CODES.ACCOUNTS_PAYABLE).maybeSingle();
      const jeNum = await getNextJournalNumber(companyId, date);
      const { data: je } = await s.from('journal_entries')
        .insert({ company_id: companyId, number: jeNum, date, type: 'general', description: `استرداد من مورد: ${reason}`, created_by: userId })
        .select('id').single();

      const jl: any[] = [];
      if (bankAccount?.account_id) jl.push({ journal_entry_id: je.id, account_id: bankAccount.account_id, debit: amount, credit: 0 });
      if (apAccount) jl.push({ journal_entry_id: je.id, account_id: apAccount.id, debit: 0, credit: amount });
      if (jl.length > 0) await s.from('journal_lines').insert(jl);

      const { data: vr, error: vrErr } = await s.from('voucher_receipts')
        .insert({ company_id: companyId, number: nextNum, date, receipt_type, contact_id, amount, bank_safe_id, reason, journal_entry_id: je.id, created_by: userId })
        .select('*').single();
      if (vrErr) throw vrErr;
      return success(vr, 201);
    }

    // General receipt
    const generalAccount = account_id;
    const { data: bankAccount } = await s.from('banks_safes').select('account_id').eq('id', bank_safe_id).maybeSingle();
    const jeNum = await getNextJournalNumber(companyId, date);
    const { data: je } = await s.from('journal_entries')
      .insert({ company_id: companyId, number: jeNum, date, type: 'general', description: `سند قبض: ${reason}`, created_by: userId })
      .select('id').single();

    const jl: any[] = [];
    if (bankAccount?.account_id) jl.push({ journal_entry_id: je.id, account_id: bankAccount.account_id, debit: amount, credit: 0 });
    if (generalAccount) jl.push({ journal_entry_id: je.id, account_id: generalAccount, debit: 0, credit: amount });
    if (jl.length > 0) await s.from('journal_lines').insert(jl);

    const { data: vr, error: vrErr } = await s.from('voucher_receipts')
      .insert({ company_id: companyId, number: nextNum, date, receipt_type, contact_id: contact_id || null, amount, bank_safe_id, reason, reference_type: reference_type || null, reference_id: reference_id || null, journal_entry_id: je.id, created_by: userId })
      .select('*').single();
    if (vrErr) throw vrErr;
    return success(vr, 201);
  } catch (err) {
    return handleApiError(err);
  }
}

export async function DELETE(request: NextRequest) {
  try {
    const auth = await requireManagerOrAbove(request);
    const s = sb();
    const url = new URL(request.url);
    const id = url.searchParams.get('id');
    if (!id) return error('id is required');

    const { data: vr } = await s.from('voucher_receipts')
      .select('*').eq('id', id).eq('company_id', auth.companyId).maybeSingle();
    if (!vr) return error('سند القبض غير موجود');

    const { data: deps } = await s.from('receipt_invoice_items').select('id').eq('voucher_receipt_id', id).limit(1);
    if (deps && deps.length > 0) return error('لا يمكن حذف سند قبض مرتبط بفواتير');

    if (vr.journal_entry_id) {
      await s.from('journal_lines').delete().eq('journal_entry_id', vr.journal_entry_id);
      await s.from('journal_entries').delete().eq('id', vr.journal_entry_id);
    }
    await s.from('voucher_receipts').delete().eq('id', id);
    return success({ deleted: true });
  } catch (err) {
    return handleApiError(err);
  }
}
