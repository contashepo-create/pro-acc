import { NextRequest } from 'next/server';
import { success, error, serverError, notFound, handleApiError, requireApiAuth, parseBody } from '@/lib/api-helpers';
import { getSupabase } from '@/lib/supabase-client';
import { ACCOUNT_CODES } from '@/lib/constants';

// @ts-ignore
const sb = () => getSupabase() as any;

export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const auth = await requireApiAuth(req);
    const { id } = await params;
    const data = await parseBody(req);
    const { settlement_amount, description, created_by } = data;

    if (!settlement_amount) return error('settlement_amount is required');

    const s = sb();

    // Get custody
    const { data: custody, error: custodyErr } = await s.from('custodies')
      .select('*')
      .eq('id', id)
      .maybeSingle();

    if (custodyErr || !custody) throw new Error('Not found');
    if (custody.status !== 'open') throw new Error('العهدة مقفلة بالفعل');

    const amount = parseFloat(custody.amount);
    const settlement = parseFloat(settlement_amount);
    const shortage = amount - settlement;

    // Update custody
    await s.from('custodies')
      .update({
        settlement_amount: settlement,
        settlement_date: data.date || new Date().toISOString().split('T')[0],
        status: 'settled',
        settlement_description: description,
        updated_at: new Date().toISOString(),
      })
      .eq('id', id);

    // Get expense account
    const { data: expenseAccount } = await s.from('accounts')
      .select('id')
      .eq('company_id', custody.company_id)
      .eq('code', ACCOUNT_CODES.EMPLOYEE_CUSTODIES)
      .maybeSingle();

    if (!expenseAccount) throw new Error('الحساب غير موجود');

    // Get next JE number
    const { data: maxJe } = await s.from('journal_entries')
      .select('number')
      .eq('company_id', custody.company_id)
      .order('number', { ascending: false })
      .limit(1)
      .maybeSingle();

    const nextNumber = (maxJe?.number || 0) + 1;

    // Create journal entry
    const { data: je, error: jeErr } = await s.from('journal_entries')
      .insert({
        company_id: custody.company_id,
        number: nextNumber,
        date: data.date || new Date().toISOString().split('T')[0],
        type: 'general',
        description: `تسوية عهدة: ${custody.description || ''}`,
        created_by: created_by || auth.userId,
      })
      .select('*')
      .single();

    if (jeErr) throw jeErr;
    const jeId = je.id;

    // Settlement credit to bank
    if (settlement > 0) {
      const { data: bankAccount } = await s.from('banks_safes')
        .select('account_id')
        .eq('id', custody.bank_safe_id)
        .maybeSingle();

      if (bankAccount) {
        await s.from('journal_lines').insert({
          journal_entry_id: jeId,
          account_id: bankAccount.account_id,
          debit: settlement,
          credit: 0,
        });
      }
    }

    // Debit expense account for full amount
    await s.from('journal_lines').insert({
      journal_entry_id: jeId,
      account_id: expenseAccount.id,
      debit: 0,
      credit: amount,
    });

    // Shortage
    if (shortage > 0) {
      const { data: shortageAcct } = await s.from('accounts')
        .select('id')
        .eq('company_id', custody.company_id)
        .eq('code', ACCOUNT_CODES.DIRECT_COSTS)
        .maybeSingle();

      if (shortageAcct) {
        await s.from('journal_lines').insert({
          journal_entry_id: jeId,
          account_id: shortageAcct.id,
          debit: shortage,
          credit: 0,
        });
      }
    }

    return success({ ...custody, settlement_amount: settlement, status: 'settled' });
  } catch (e: any) {
    if (e.message === 'Not found') return notFound();
    return serverError(e);
  }
}
