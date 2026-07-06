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
      `SELECT vr.*, c.name AS contact_name, bs.name AS bank_safe_name, je.sequence_number AS journal_entry_number
       FROM voucher_receipts vr
       LEFT JOIN contacts c ON c.id = vr.contact_id
       LEFT JOIN banks_safes bs ON bs.id = vr.bank_safe_id
       LEFT JOIN journal_entries je ON je.id = vr.journal_entry_id
       WHERE vr.id = $1 AND vr.company_id = $2`,
      [id, ctx.companyId]
    );

    if (voucherRes.rows.length === 0) {
      return notFound();
    }

    const invoiceItemsRes = await query(
      `SELECT rii.*, i.number AS invoice_number
       FROM receipt_invoice_items rii
       LEFT JOIN invoices i ON i.id = rii.invoice_id
       WHERE rii.voucher_receipt_id = $1`,
      [id]
    );

    return success({
      ...voucherRes.rows[0],
      invoice_items: invoiceItemsRes.rows,
    });
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
      `SELECT vr.* FROM voucher_receipts vr WHERE vr.id = $1 AND vr.company_id = $2`,
      [id, ctx.companyId]
    );

    if (voucherRes.rows.length === 0) {
      return notFound();
    }

    const voucher = voucherRes.rows[0];

    const depRes = await query(
      `SELECT id FROM cash_transactions WHERE voucher_receipt_id = $1 LIMIT 1`,
      [id]
    );

    if (depRes.rows.length > 0) {
      return error('لا يمكن حذف سند القبض لأنه مرتبط بحركات نقدية');
    }

    await transaction(async (client) => {
      await client.query(
        `DELETE FROM receipt_invoice_items WHERE voucher_receipt_id = $1`,
        [id]
      );

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
        `DELETE FROM voucher_receipts WHERE id = $1`,
        [id]
      );
    });

    return success({ deleted: true });
  } catch (err) {
    return handleApiError(err);
  }
}
