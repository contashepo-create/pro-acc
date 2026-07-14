import { NextRequest } from 'next/server';
import { success, error, parseBody, requireApiAuth, handleApiError } from '@/lib/api-helpers';
import { getSupabase } from '@/lib/supabase-client';
import { ACCOUNT_CODES } from '@/lib/constants';
import { getNextJournalNumber } from '@/lib/numbering';

const sb = () => getSupabase();

export async function POST(req: NextRequest) {
  try {
    const auth = await requireApiAuth(req);
    const data = await parseBody(req);
    const { contract_id, certificate_id, amount, date, bank_safe_id, notes } = data;

    if (!auth.companyId || !contract_id || !amount || !date || !bank_safe_id) {
      return error('company_id, contract_id, amount, date, bank_safe_id are required');
    }

    const s = sb();

    // Insert payment
    const { data: payment, error: payErr } = await s.from('subcontractor_payments')
      .insert({
        company_id: auth.companyId,
        contract_id,
        certificate_id: certificate_id || null,
        amount,
        date,
        bank_safe_id,
        notes,
        created_by: auth.userId,
      })
      .select('*')
      .single();

    if (payErr) throw payErr;

    // Get accounts
    const { data: apAccount } = await s.from('accounts')
      .select('id')
      .eq('company_id', auth.companyId)
      .eq('code', ACCOUNT_CODES.SUBCONTRACTOR_PAYABLES)
      .maybeSingle();

    const { data: bankAccount } = await s.from('banks_safes')
      .select('account_id')
      .eq('id', bank_safe_id)
      .maybeSingle();

    if (apAccount && bankAccount) {
      // FIXED: Use atomic RPC-based numbering instead of manual MAX+1
      const nextNumber = await getNextJournalNumber(auth.companyId, date);

      const { data: je, error: jeErr } = await s.from('journal_entries')
        .insert({
          company_id: auth.companyId,
          number: nextNumber,
          date,
          type: 'general',
          description: 'دفعة مقاول باطن',
          created_by: auth.userId,
        })
        .select('*')
        .single();

      if (jeErr) throw jeErr;

      await s.from('journal_lines').insert([
        { journal_entry_id: je.id, account_id: apAccount.id, debit: amount, credit: 0 },
        { journal_entry_id: je.id, account_id: bankAccount.account_id, debit: 0, credit: amount },
      ]);
    }

    return success(payment, 201);
  } catch (err) {
    return handleApiError(err);
  }
}
