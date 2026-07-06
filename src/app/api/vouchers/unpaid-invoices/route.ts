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

    const invoicesRes = await query(
      `SELECT id, number, date, total, paid_amount, status,
              (total - COALESCE(paid_amount, 0)) AS remaining
       FROM invoices
       WHERE contact_id = $1 AND company_id = $2 AND status IN ('unpaid', 'partial')
       ORDER BY date DESC`,
      [contactId, auth.companyId]
    );

    return success({
      invoices: invoicesRes.rows.map((inv) => ({
        ...inv,
        total: parseFloat(inv.total),
        paid_amount: parseFloat(inv.paid_amount || '0'),
        remaining: parseFloat(inv.remaining),
      })),
    });
  } catch (err) {
    return handleApiError(err);
  }
}
