import { NextRequest } from 'next/server';
import { success, error, requireApiAuth, handleApiError } from '@/lib/api-helpers';
import { getSupabase } from '@/lib/supabase-client';

// @ts-ignore
const sb = () => getSupabase() as any;

export async function GET(request: NextRequest) {
  try {
    const auth = await requireApiAuth(request);
    const url = new URL(request.url);
    const contactId = url.searchParams.get('contactId');

    if (!contactId) {
      return error('رقم العميل مطلوب');
    }

    const s = sb();

    const { data: advAccount } = await s.from('accounts')
      .select('id')
      .eq('code', '2180')
      .eq('company_id', auth.companyId)
      .maybeSingle();

    if (!advAccount) {
      return success({
        contact_id: contactId,
        balance: 0,
        message: 'حساب الدفعات المقدمة غير موجود',
      });
    }

    const { data: jeIds } = await s.from('journal_entries')
      .select('id')
      .eq('company_id', auth.companyId);

    const jeIdList = (jeIds || []).map((je: any) => je.id);

    if (jeIdList.length === 0) {
      return success({
        contact_id: contactId,
        balance: 0,
      });
    }

    const { data: lines } = await s.from('journal_lines')
      .select('debit, credit')
      .eq('account_id', advAccount.id)
      .eq('contact_id', contactId)
      .in('journal_entry_id', jeIdList);

    const totalCredit = (lines || []).reduce((sum: number, l: any) => sum + (parseFloat(l.credit) || 0), 0);
    const totalDebit = (lines || []).reduce((sum: number, l: any) => sum + (parseFloat(l.debit) || 0), 0);
    const balance = totalCredit - totalDebit;

    return success({
      contact_id: contactId,
      balance: Math.max(0, balance),
    });
  } catch (err) {
    return handleApiError(err);
  }
}
