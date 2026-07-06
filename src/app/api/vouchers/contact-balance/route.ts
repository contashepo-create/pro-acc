import { NextRequest } from 'next/server';
import { success, error, requireApiAuth, handleApiError } from '@/lib/api-helpers';
import { query } from '@/lib/db';

export async function GET(request: NextRequest) {
  try {
    const auth = await requireApiAuth(request);
    const url = new URL(request.url);
    const contactId = url.searchParams.get('contactId');

    if (!contactId) {
      return error('رقم الطرف مطلوب');
    }

    const contactRes = await query(
      `SELECT id, account_id, type FROM contacts WHERE id = $1 AND company_id = $2`,
      [contactId, auth.companyId]
    );

    if (contactRes.rows.length === 0) {
      return error('الطرف غير موجود');
    }

    const contact = contactRes.rows[0];

    if (!contact.account_id) {
      return success({
        contact_id: contactId,
        balance: 0,
        balance_type: null,
        message: 'لا يوجد حساب محاسبي للطرف',
      });
    }

    const balRes = await query(
      `SELECT COALESCE(SUM(debit), 0) AS total_debit, COALESCE(SUM(credit), 0) AS total_credit
       FROM journal_lines
       WHERE account_id = $1 AND journal_entry_id IN (
         SELECT je.id FROM journal_entries je WHERE je.company_id = $2
       )`,
      [contact.account_id, auth.companyId]
    );

    const totalDebit = parseFloat(balRes.rows[0].total_debit);
    const totalCredit = parseFloat(balRes.rows[0].total_credit);
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
