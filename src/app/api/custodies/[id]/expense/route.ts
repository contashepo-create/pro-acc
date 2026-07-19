import { NextRequest } from 'next/server';
import { success, error, parseBody, requireApiAuth, handleApiError } from '@/lib/api-helpers';
import { getSupabase } from '@/lib/supabase-client';
import { getNextJournalNumber } from '@/lib/numbering';
import { ACCOUNT_CODES } from '@/lib/constants';
import { insertJournalLines } from '@/lib/journal-utils';

const sb = () => getSupabase();

/**
 * Record invoice/expense and deduct from custody WITHOUT duplication
 * This prevents double counting: invoice amount is not recorded as separate expense,
 * but transferred from custody account to expense account
 */
export async function POST(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const auth = await requireApiAuth(request);
    const { id } = await params;
    const body = await parseBody(request);
    const { amount, description, invoice_id, purchase_invoice_id, expense_account_code } = body;

    if (!amount) return error('المبلغ مطلوب');
    if (!description) return error('الوصف مطلوب');

    const s = sb();

    const { data: custody, error: custErr } = await s.from('custodies')
      .select('*')
      .eq('id', id)
      .eq('company_id', auth.companyId)
      .maybeSingle();

    if (custErr || !custody) return error('ملف العهدة غير موجود', 404);
    if (custody.status !== 'open') return error('ملف العهدة مقفل', 400);

    const remaining = parseFloat(custody.remaining_amount) || parseFloat(custody.amount) || 0;
    if (parseFloat(amount) > remaining) {
      return error(`المبلغ المطلوب ${amount} أكبر من المتبقي في العهدة ${remaining}`, 400);
    }

    // Check if invoice already linked to avoid duplication
    if (invoice_id) {
      const { data: existing } = await s.from('custody_invoices')
        .select('id')
        .eq('custody_id', id)
        .eq('invoice_id', invoice_id)
        .maybeSingle();
      if (existing) return error('هذه الفاتورة مرتبطة بالفعل بهذه العهدة', 400);
    }

    // Create transaction - expense from custody
    const { data: transaction, error: txErr } = await s.from('custody_transactions')
      .insert({
        company_id: auth.companyId,
        custody_id: id,
        type: 'expense',
        amount,
        description,
        reference_type: invoice_id ? 'invoice' : purchase_invoice_id ? 'purchase_invoice' : 'general',
        reference_id: invoice_id || purchase_invoice_id || null,
        created_by: auth.userId,
      })
      .select()
      .single();

    if (txErr) throw txErr;

    // If invoice linked, create link to prevent duplication
    if (invoice_id || purchase_invoice_id) {
      await s.from('custody_invoices').insert({
        company_id: auth.companyId,
        custody_id: id,
        invoice_id: invoice_id || null,
        purchase_invoice_id: purchase_invoice_id || null,
        amount,
        description,
      });
    }

    // Journal: The key to avoid duplication
    // Instead of: debit expense / credit supplier (which would duplicate)
    // We do: debit expense / credit custody account
    // So expense is recorded, but custody is reduced, not creating new liability
    const expenseCode = expense_account_code || ACCOUNT_CODES.DIRECT_COSTS || '5100';
    const { data: expenseAcc } = await s.from('accounts')
      .select('id')
      .eq('company_id', auth.companyId)
      .eq('code', expenseCode)
      .maybeSingle();

    const { data: custodyAcc } = await s.from('accounts')
      .select('id')
      .eq('company_id', auth.companyId)
      .eq('code', ACCOUNT_CODES.EMPLOYEE_CUSTODIES)
      .maybeSingle();

    if (expenseAcc && custodyAcc) {
      const jeNum = await getNextJournalNumber(auth.companyId, new Date().toISOString());
      const { data: je } = await s.from('journal_entries')
        .insert({
          company_id: auth.companyId,
          number: jeNum,
          date: new Date().toISOString().split('T')[0],
          type: 'general',
          description: `مصروف من عهدة: ${description} - ملف ${id}`,
          created_by: auth.userId,
        })
        .select('id')
        .single();

      // استخدام الدالة المساعدة لإدراج سطور القيد بجميع الحقول المطلوبة
      const { error: jlErr } = await insertJournalLines(auth.companyId, [
        { journal_entry_id: je.id, account_id: expenseAcc.id, debit: amount, credit: 0, description },
        { journal_entry_id: je.id, account_id: custodyAcc.id, debit: 0, credit: amount, description: `خصم من عهدة ${custody.employee_id}` },
      ]);
      if (jlErr) console.error('Journal lines error:', jlErr);
    }

    // Update remaining via trigger will happen, but also update manually for immediate feedback
    const newRemaining = remaining - parseFloat(amount);
    await s.from('custodies').update({
      remaining_amount: newRemaining,
      total_expenses: (parseFloat(custody.total_expenses) || 0) + parseFloat(amount),
    }).eq('id', id);

    return success({
      transaction,
      remaining: newRemaining,
      message: `تم خصم ${amount} من العهدة بدون تكرار. المتبقي: ${newRemaining}`,
    }, 201);
  } catch (err) {
    return handleApiError(err);
  }
}
