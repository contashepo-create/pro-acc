import { NextRequest } from 'next/server';
import { success, error, requireApiAuth, handleApiError } from '@/lib/api-helpers';
import { query } from '@/lib/db';

export async function GET(request: NextRequest) {
  try {
    const auth = await requireApiAuth(request);
    const url = new URL(request.url);
    const contactId = url.searchParams.get('contactId');

    if (!contactId) {
      return error('رقم العميل مطلوب');
    }

    const advAccRes = await query(
      `SELECT id FROM accounts WHERE code = '2180' AND company_id = $1 LIMIT 1`,
      [auth.companyId]
    );

    if (advAccRes.rows.length === 0) {
      return success({
        contact_id: contactId,
        balance: 0,
        message: 'حساب الدفعات المقدمة غير موجود',
      });
    }

    const advAccountId = advAccRes.rows[0].id;

    const balRes = await query(
      `SELECT COALESCE(SUM(credit) - SUM(debit), 0) AS advance_balance
       FROM journal_lines
       WHERE account_id = $1
         AND contact_id = $2
         AND journal_entry_id IN (
           SELECT je.id FROM journal_entries je WHERE je.company_id = $3
         )`,
      [advAccountId, contactId, auth.companyId]
    );

    const balance = parseFloat(balRes.rows[0].advance_balance);

    return success({
      contact_id: contactId,
      balance: Math.max(0, balance),
    });
  } catch (err) {
    return handleApiError(err);
  }
}
