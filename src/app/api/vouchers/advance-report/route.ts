import { NextRequest } from 'next/server';
import { success, requireApiAuth, handleApiError } from '@/lib/api-helpers';
import { getSupabase } from '@/lib/supabase-client';

const sb = () => getSupabase();

export async function GET(request: NextRequest) {
  try {
    const auth = await requireApiAuth(request);
    const s = sb();

    const { data: advAccount } = await s.from('accounts')
      .select('id')
      .eq('code', '2180')
      .eq('company_id', auth.companyId)
      .maybeSingle();

    if (!advAccount) {
      return success([]);
    }

    const advAccountId = advAccount.id;

    const { data: jeIds } = await s.from('journal_entries')
      .select('id')
      .eq('company_id', auth.companyId);

    const jeIdList = (jeIds || []).map((je) => je.id);

    if (jeIdList.length === 0) {
      return success([]);
    }

    const { data: lines } = await s.from('journal_lines')
      .select('contact_id, debit, credit')
      .eq('account_id', advAccountId)
      .in('journal_entry_id', jeIdList)
      .not('contact_id', 'is', null);

    // Aggregate by contact_id
    interface AdvanceBalance {
      contact_id: string;
      contact_name: string;
      balance: number;
    }
    const balances: Record<string, AdvanceBalance> = {};
    const contactIds = [...new Set((lines || []).map((l: { contact_id: string | null }) => l.contact_id))];

    for (const cid of contactIds) {
      if (!cid) continue;
      const contactLines = (lines || []).filter((l: { contact_id: string | null }) => l.contact_id === cid);
      const totalCredit = contactLines.reduce((sum, l) => sum + (parseFloat(l.credit) || 0), 0);
      const totalDebit = contactLines.reduce((sum, l) => sum + (parseFloat(l.debit) || 0), 0);
      const balance = totalCredit - totalDebit;

      if (balance > 0.01) {
        const { data: contact } = await s.from('contacts')
          .select('name')
          .eq('id', cid)
          .maybeSingle();
        balances[cid] = {
          contact_id: cid,
          contact_name: contact?.name || '',
          balance,
        };
      }
    }

    const result = Object.values(balances).sort((a, b) => a.contact_name.localeCompare(b.contact_name));

    return success(result);
  } catch (err) {
    return handleApiError(err);
  }
}
