import { NextRequest } from 'next/server';
import { success, error, serverError, requireApiAuth, handleApiError } from '@/lib/api-helpers';
import { query } from '@/lib/db';
import { ACCOUNT_CODES } from '@/lib/constants';

export async function GET(req: NextRequest) {
  try {
    const auth = await requireApiAuth(req);
    const url = new URL(req.url);
    const type = url.searchParams.get('type') || 'ar';
    const asOf = url.searchParams.get('asOf') || new Date().toISOString().split('T')[0];

    if (type === 'ar') {
      const account = await query(
        `SELECT id FROM accounts WHERE company_id = $1 AND code = $2 LIMIT 1`,
        [auth.companyId, ACCOUNT_CODES.ACCOUNTS_RECEIVABLE]
      );
      if (account.rows.length === 0) return success({ aging: [] });

      const contacts = await query(
        `SELECT DISTINCT c.id, c.name,
          COALESCE(SUM(jl.debit - jl.credit), 0) as balance,
          MAX(je.date) as last_invoice_date
         FROM contacts c
         JOIN invoices i ON c.id = i.contact_id
         LEFT JOIN journal_lines jl ON jl.contact_id = c.id
         LEFT JOIN journal_entries je ON jl.journal_entry_id = je.id
         WHERE c.company_id = $1 AND c.type IN ('client', 'both') AND c.is_active = true
         GROUP BY c.id, c.name
         HAVING COALESCE(SUM(jl.debit - jl.credit), 0) > 0
         ORDER BY c.name`,
        [auth.companyId]
      );

      const aging = contacts.rows.map((c: any) => {
        const balance = parseFloat(c.balance) || 0;
        const lastDate = c.last_invoice_date || asOf;
        const daysDiff = Math.floor((new Date(asOf).getTime() - new Date(lastDate).getTime()) / (1000 * 60 * 60 * 24));
        let bucket = '90+';
        if (daysDiff <= 30) bucket = '0-30';
        else if (daysDiff <= 60) bucket = '31-60';
        else if (daysDiff <= 90) bucket = '61-90';
        return { ...c, balance, days_overdue: Math.max(0, daysDiff), bucket };
      });

      return success({ aging, type: 'ar', asOf });
    }

    if (type === 'ap') {
      const account = await query(
        `SELECT id FROM accounts WHERE company_id = $1 AND code = $2 LIMIT 1`,
        [auth.companyId, ACCOUNT_CODES.ACCOUNTS_PAYABLE]
      );
      if (account.rows.length === 0) return success({ aging: [] });

      const suppliers = await query(
        `SELECT DISTINCT c.id, c.name,
          COALESCE(SUM(jl.credit - jl.debit), 0) as balance,
          MAX(pi.date) as last_invoice_date
         FROM contacts c
         JOIN purchase_invoices pi ON c.id = pi.supplier_id
         LEFT JOIN journal_lines jl ON jl.contact_id = c.id
         LEFT JOIN journal_entries je ON jl.journal_entry_id = je.id
         WHERE c.company_id = $1 AND c.type IN ('supplier', 'both') AND c.is_active = true
         GROUP BY c.id, c.name
         HAVING COALESCE(SUM(jl.credit - jl.debit), 0) > 0
         ORDER BY c.name`,
        [auth.companyId]
      );

      const aging = suppliers.rows.map((c: any) => {
        const balance = parseFloat(c.balance) || 0;
        const lastDate = c.last_invoice_date || asOf;
        const daysDiff = Math.floor((new Date(asOf).getTime() - new Date(lastDate).getTime()) / (1000 * 60 * 60 * 24));
        let bucket = '90+';
        if (daysDiff <= 30) bucket = '0-30';
        else if (daysDiff <= 60) bucket = '31-60';
        else if (daysDiff <= 90) bucket = '61-90';
        return { ...c, balance, days_overdue: Math.max(0, daysDiff), bucket };
      });

      return success({ aging, type: 'ap', asOf });
    }

    return error('Invalid aging type. Use "ar" or "ap"');
  } catch (err) {
    return handleApiError(err);
  }
}
