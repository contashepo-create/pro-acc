import { NextRequest } from 'next/server';
import { success, error, serverError, parseBody, notFound } from '@/lib/api-helpers';
import { query, transaction } from '@/lib/db';

export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await params;
    const data = await parseBody(req);
    const { created_by } = data;

    const result = await transaction(async (client) => {
      const fy = await client.query(`SELECT * FROM fiscal_years WHERE id = $1 FOR UPDATE`, [id]);
      if (fy.rows.length === 0) throw new Error('Not found');
      if (fy.rows[0].status !== 'closed') throw new Error('السنة المالية غير مقفلة');

      const companyId = fy.rows[0].company_id;

      const newerClosed = await client.query(
        `SELECT id FROM fiscal_years WHERE company_id = $1 AND status = 'closed' AND start_date > $2 ORDER BY start_date`,
        [companyId, fy.rows[0].start_date]
      );

      for (const newer of newerClosed.rows) {
        await client.query(`UPDATE fiscal_years SET status = 'open', closed_at = NULL, closed_by = NULL WHERE id = $1`,
          [newer.id]);
      }

      await client.query(`DELETE FROM journal_lines WHERE journal_entry_id IN
        (SELECT id FROM journal_entries WHERE company_id = $1 AND date >= $2 AND date <= $3 AND type = 'closing')`,
        [companyId, fy.rows[0].start_date, fy.rows[0].end_date]);

      await client.query(`DELETE FROM journal_entries WHERE company_id = $1 AND date >= $2 AND date <= $3 AND type = 'closing'`,
        [companyId, fy.rows[0].start_date, fy.rows[0].end_date]);

      await client.query(
        `UPDATE fiscal_years SET status = 'open', closed_at = NULL, closed_by = NULL WHERE id = $1`,
        [id]
      );

      return { ...fy.rows[0], status: 'open' };
    });

    return success(result);
  } catch (e: any) {
    if (e.message?.includes('Not found')) return notFound();
    return error(e.message || 'خطأ في فتح السنة المالية');
  }
}
