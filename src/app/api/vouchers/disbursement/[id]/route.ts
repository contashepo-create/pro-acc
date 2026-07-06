import { NextRequest } from 'next/server';
import { success, error, unauthorized, serverError, notFound, handleApiError } from '@/lib/api-helpers';
import { query, transaction } from '@/lib/db';
import { getCompanyContext } from '@/lib/auth';

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const ctx = await getCompanyContext(request);
  if (!ctx) return unauthorized();

  try {
    const { id } = await params;

    const voucherRes = await query(
      `SELECT vd.*, c.name AS contact_name, bs.name AS bank_safe_name, je.sequence_number AS journal_entry_number,
              e.name AS employee_name
       FROM voucher_disbursements vd
       LEFT JOIN contacts c ON c.id = vd.contact_id
       LEFT JOIN banks_safes bs ON bs.id = vd.bank_safe_id
       LEFT JOIN journal_entries je ON je.id = vd.journal_entry_id
       LEFT JOIN employees e ON e.id = vd.employee_id
       WHERE vd.id = $1 AND vd.company_id = $2`,
      [id, ctx.companyId]
    );

    if (voucherRes.rows.length === 0) {
      return notFound();
    }

    return success(voucherRes.rows[0]);
  } catch (err) {
    return handleApiError(err);
  }
}

export async function DELETE(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const ctx = await getCompanyContext(request);
  if (!ctx) return unauthorized();

  try {
    const { id } = await params;

    const voucherRes = await query(
      `SELECT vd.* FROM voucher_disbursements vd WHERE vd.id = $1 AND vd.company_id = $2`,
      [id, ctx.companyId]
    );

    if (voucherRes.rows.length === 0) {
      return notFound();
    }

    const voucher = voucherRes.rows[0];

    const depRes = await query(
      `SELECT id FROM cash_transactions WHERE voucher_disbursement_id = $1 LIMIT 1`,
      [id]
    );

    if (depRes.rows.length > 0) {
      return error('لا يمكن حذف سند الصرف لأنه مرتبط بحركات نقدية');
    }

    await transaction(async (client) => {
      if (voucher.disbursement_type === 'employee_advance' && voucher.employee_id) {
        await client.query(
          `DELETE FROM employee_advances WHERE journal_entry_id = $1`,
          [voucher.journal_entry_id]
        );
      }

      if (voucher.journal_entry_id) {
        await client.query(
          `DELETE FROM journal_lines WHERE journal_entry_id = $1`,
          [voucher.journal_entry_id]
        );
        await client.query(
          `DELETE FROM journal_entries WHERE id = $1`,
          [voucher.journal_entry_id]
        );
      }

      await client.query(
        `DELETE FROM voucher_disbursements WHERE id = $1`,
        [id]
      );
    });

    return success({ deleted: true });
  } catch (err) {
    return handleApiError(err);
  }
}
