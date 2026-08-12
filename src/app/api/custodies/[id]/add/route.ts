import { NextRequest } from 'next/server';
import { success, error, parseBody, requireApiAuth, handleApiError, requireModulePermission } from '@/lib/api-helpers';
import { getSupabase } from '@/lib/supabase-client';
import { ACCOUNT_CODES } from '@/lib/constants';
import { createJournalEntry } from '@/lib/journal-utils';

const sb = () => getSupabase();

export async function POST(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const auth = await requireModulePermission(request, 'custodies', 'create');
    const { id } = await params;
    const body = await parseBody(request);
    const { amount, bank_safe_id, description } = body;

    if (!amount || !bank_safe_id) return error('amount, bank_safe_id مطلوبان');

    const s = sb();

    const { data: custody, error: custErr } = await s.from('custodies')
      .select('*')
      .eq('id', id)
      .eq('company_id', auth.companyId)
      .maybeSingle();

    if (custErr || !custody) return error('ملف العهدة غير موجود', 404);
    if (custody.status !== 'open') return error('ملف العهدة مقفل', 400);

    // Create transaction
    const { data: transaction, error: txErr } = await s.from('custody_transactions')
      .insert({
        company_id: auth.companyId,
        custody_id: id,
        type: 'addition',
        amount,
        description: description || 'إضافة مبلغ للعهدة',
        created_by: auth.userId,
      })
      .select()
      .single();

    if (txErr) {
      console.warn('custody_transactions insert failed (table may not exist):', txErr);
    }

    // Journal: debit custody, credit bank
    const { data: custAcc } = await s.from('accounts').select('id, code, name').eq('company_id', auth.companyId).eq('code', ACCOUNT_CODES.EMPLOYEE_CUSTODIES).maybeSingle();
    const { data: bankAcc } = await s.from('banks_safes').select('account_id').eq('id', bank_safe_id).eq('company_id', auth.companyId).maybeSingle();

    if (!custAcc || !bankAcc?.account_id) {
      return error('حساب العهدة أو حساب الخزينة غير مكتمل', 400);
    }
    const { error: jeErr } = await createJournalEntry(auth.companyId, {
      date: new Date().toISOString().split('T')[0],
      type: 'general',
      description: `إضافة عهدة: ${description || ''}`,
      reference_type: 'custody_add',
      reference_id: id,
      created_by: auth.userId,
      lines: [
        { account_id: custAcc.id, debit: amount, credit: 0, description: `إضافة عهدة ${id}` },
        { account_id: bankAcc.account_id, debit: 0, credit: amount, description: `صرف عهدة ${id}` },
      ],
    });
    if (jeErr) throw jeErr;

    // Update remaining amount
    const currentRemaining = parseFloat(custody.remaining_amount) || parseFloat(custody.amount) || 0;
    await s.from('custodies').update({
      remaining_amount: currentRemaining + parseFloat(amount),
    }).eq('id', id);

    return success({ transaction, message: 'تمت إضافة المبلغ للعهدة' }, 201);
  } catch (err) {
    return handleApiError(err);
  }
}
