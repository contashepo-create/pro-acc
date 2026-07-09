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
      return error('رقم الطرف مطلوب');
    }

    const s = sb();

    const { data: contact, error: contactError } = await s.from('contacts')
      .select('id, account_id, type')
      .eq('id', contactId)
      .eq('company_id', auth.companyId)
      .maybeSingle();

    if (contactError || !contact) {
      return error('الطرف غير موجود');
    }

    if (!contact.account_id) {
      return success({
        contact_id: contactId,
        balance: 0,
        balance_type: null,
        message: 'لا يوجد حساب محاسبي للطرف',
      });
    }

    const { data: jeIds } = await s.from('journal_entries')
      .select('id')
      .eq('company_id', auth.companyId);

    const jeIdList = (jeIds || []).map((je: any) => je.id);

    const { data: lines } = await s.from('journal_lines')
      .select('debit, credit')
      .eq('account_id', contact.account_id)
      .in('journal_entry_id', jeIdList.length > 0 ? jeIdList : ['00000000-0000-0000-0000-000000000000']);

    const totalDebit = (lines || []).reduce((sum: number, l: any) => sum + (parseFloat(l.debit) || 0), 0);
    const totalCredit = (lines || []).reduce((sum: number, l: any) => sum + (parseFloat(l.credit) || 0), 0);
    const netBalance = totalDebit - totalCredit;

    if (contact.type === 'supplier' || contact.type === 'subcontractor') {
      return success({
        contact_id: contactId,
        balance: Math.abs(netBalance),
        balance_type: netBalance >= 0 ? 'debit' : 'credit',
        total_debit: totalDebit,
        total_credit: totalCredit,
        label: netBalance >= 0 ? 'مدين له' : 'دائن/مستحق له',
        color: netBalance >= 0 ? 'green' : 'pink',
      });
    }

    return success({
      contact_id: contactId,
      balance: Math.abs(netBalance),
      balance_type: netBalance >= 0 ? 'debit' : 'credit',
      total_debit: totalDebit,
      total_credit: totalCredit,
      label: netBalance >= 0 ? 'مدين' : 'دائن',
    });
  } catch (err) {
    return handleApiError(err);
  }
}
