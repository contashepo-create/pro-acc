import { NextRequest } from 'next/server';
import { success, error, notFound, handleApiError } from '@/lib/api-helpers';
import { getSupabase } from '@/lib/supabase-client';
import { getNextJournalNumber } from '@/lib/numbering';

const sb = () => getSupabase();

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { requireApiAuth } = await import('@/lib/api-helpers');
    const ctx = await requireApiAuth(request);
    const { id } = await params;
    const s = sb();

    const { data: voucher } = await s.from('voucher_receipts')
      .select('*, contacts!contact_id(name), banks_safes!bank_safe_id(name), journal_entries!journal_entry_id(number)')
      .eq('id', id)
      .eq('company_id', ctx.companyId)
      .maybeSingle();

    if (!voucher) return notFound();

    const { data: invoiceItems } = await s.from('receipt_invoice_items')
      .select('*, invoices!invoice_id(number)')
      .eq('voucher_receipt_id', id);

    return success({
      ...(voucher as any),
      contact_name: (voucher as any).contacts?.name || null,
      bank_safe_name: (voucher as any).banks_safes?.name || null,
      journal_entry_number: (voucher as any).journal_entries?.number || null,
      invoice_items: (invoiceItems || []).map((ri: any) => ({
        ...ri,
        invoice_number: ri.invoices?.number || null,
      })),
    });
  } catch (err) {
    return handleApiError(err);
  }
}

export async function PUT(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { requireManagerOrAbove } = await import('@/lib/api-helpers');
    const ctx = await requireManagerOrAbove(request);
    const { id } = await params;
    const s = sb();
    const body = await request.json();

    // جلب السند الحالي
    const { data: oldVoucher } = await s.from('voucher_receipts')
      .select('*')
      .eq('id', id)
      .eq('company_id', ctx.companyId)
      .maybeSingle();

    if (!oldVoucher) return notFound();

    const old = oldVoucher as any;

    // التحقق من أن السند ليس مرتبط بحركات نقدية
    const { data: depRes } = await s.from('cash_transactions')
      .select('id')
      .eq('voucher_receipt_id', id)
      .limit(1);

    if (depRes && depRes.length > 0) {
      return error('لا يمكن تعديل سند القبض لأنه مرتبط بحركات نقدية');
    }

    // حذف القيد القديم
    if (old.journal_entry_id) {
      await s.from('journal_lines').delete().eq('journal_entry_id', old.journal_entry_id);
      await s.from('journal_entries').delete().eq('id', old.journal_entry_id);
    }

    // إنشاء قيد جديد
    const { data: bankAccount } = await s.from('banks_safes')
      .select('account_id')
      .eq('id', body.bank_safe_id)
      .maybeSingle();

    if (!bankAccount?.account_id) {
      return error('الحساب البنكي غير موجود');
    }

    const jeNum = await getNextJournalNumber(ctx.companyId, body.date || old.date);
    const { data: je, error: jeErr } = await s.from('journal_entries')
      .insert({
        company_id: ctx.companyId,
        number: jeNum,
        date: body.date || old.date,
        type: 'general',
        description: `سند قبض: ${body.reason || old.reason}`,
        reference_type: 'voucher_receipt',
        reference_id: id,
        created_by: ctx.userId,
      })
      .select('id')
      .single();

    if (jeErr) throw jeErr;

    // إنشاء سطور القيد
    const jl: any[] = [
      {
        journal_entry_id: je.id,
        account_id: bankAccount.account_id,
        debit: body.amount || old.amount,
        credit: 0,
      }
    ];

    // الحساب المقابل
    let counterpartAccountId = body.account_id || null;
    if (!counterpartAccountId && old.contact_id) {
      const { data: arAccount } = await s.from('accounts')
        .select('id')
        .eq('company_id', ctx.companyId)
        .eq('code', '1130')
        .maybeSingle();
      counterpartAccountId = arAccount?.id || null;
    }

    if (counterpartAccountId) {
      jl.push({
        journal_entry_id: je.id,
        account_id: counterpartAccountId,
        debit: 0,
        credit: body.amount || old.amount,
      });
    }

    await s.from('journal_lines').insert(jl);

    // تحديث السند
    const { data: updated, error: updateErr } = await s.from('voucher_receipts')
      .update({
        date: body.date || old.date,
        receipt_type: body.receipt_type || old.receipt_type,
        contact_id: body.contact_id || old.contact_id,
        amount: body.amount || old.amount,
        bank_safe_id: body.bank_safe_id || old.bank_safe_id,
        reason: body.reason || old.reason,
        journal_entry_id: je.id,
        status: 'approved',
        updated_at: new Date().toISOString(),
      })
      .eq('id', id)
      .select('*')
      .single();

    if (updateErr) throw updateErr;

    return success(updated);
  } catch (err) {
    return handleApiError(err);
  }
}

export async function DELETE(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { requireManagerOrAbove } = await import('@/lib/api-helpers');
    const ctx = await requireManagerOrAbove(request);
    const { id } = await params;
    const s = sb();

    const { data: voucher } = await s.from('voucher_receipts')
      .select('*')
      .eq('id', id)
      .eq('company_id', ctx.companyId)
      .maybeSingle();

    if (!voucher) return notFound();

    const { data: depRes } = await s.from('cash_transactions')
      .select('id')
      .eq('voucher_receipt_id', id)
      .limit(1);

    if (depRes && depRes.length > 0) {
      return error('لا يمكن حذف سند القبض لأنه مرتبط بحركات نقدية');
    }

    await s.from('receipt_invoice_items').delete().eq('voucher_receipt_id', id);

    if ((voucher as any).journal_entry_id) {
      await s.from('journal_lines').delete().eq('journal_entry_id', (voucher as any).journal_entry_id);
      await s.from('journal_entries').delete().eq('id', (voucher as any).journal_entry_id);
    }

    await s.from('voucher_receipts').delete().eq('id', id);

    return success({ deleted: true });
  } catch (err) {
    return handleApiError(err);
  }
}
