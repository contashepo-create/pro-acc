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

    const bankRes = await query(
      `SELECT bs.*, a.code AS account_code, a.name AS account_name
       FROM banks_safes bs
       LEFT JOIN accounts a ON a.id = bs.account_id
       WHERE bs.id = $1 AND bs.company_id = $2`,
      [id, ctx.companyId]
    );

    if (bankRes.rows.length === 0) {
      return notFound();
    }

    const bank = bankRes.rows[0];

    let balance = 0;
    if (bank.account_id) {
      const balRes = await query(
        `SELECT COALESCE(SUM(jl.debit - jl.credit), 0) AS balance
         FROM journal_lines jl
         WHERE jl.account_id = $1 AND jl.journal_entry_id IN (
           SELECT je.id FROM journal_entries je WHERE je.company_id = $2
         )`,
        [bank.account_id, ctx.companyId]
      );
      balance = parseFloat(balRes.rows[0].balance);
    }

    return success({ ...bank, balance });
  } catch (err) {
    return handleApiError(err);
  }
}

export async function PUT(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const ctx = await getCompanyContext(request);
  if (!ctx) return unauthorized();

  try {
    const { id } = await params;
    const body = await request.json();

    const bankRes = await query(
      `SELECT bs.* FROM banks_safes bs WHERE bs.id = $1 AND bs.company_id = $2`,
      [id, ctx.companyId]
    );

    if (bankRes.rows.length === 0) {
      return notFound();
    }

    await transaction(async (client) => {
      const updates: string[] = [];
      const updateParams: any[] = [];
      let paramIdx = 1;

      if (body.name !== undefined) {
        updates.push(`name = $${paramIdx++}`);
        updateParams.push(body.name);
      }
      if (body.type !== undefined) {
        updates.push(`type = $${paramIdx++}`);
        updateParams.push(body.type);
      }
      if (body.account_number !== undefined) {
        updates.push(`account_number = $${paramIdx++}`);
        updateParams.push(body.account_number);
      }
      if (body.is_active !== undefined) {
        updates.push(`is_active = $${paramIdx++}`);
        updateParams.push(body.is_active);
      }

      if (updates.length > 0) {
        updateParams.push(id);
        await client.query(
          `UPDATE banks_safes SET ${updates.join(', ')} WHERE id = $${paramIdx}`,
          updateParams
        );
      }
    });

    const updated = await query(
      `SELECT bs.*, a.code AS account_code, a.name AS account_name
       FROM banks_safes bs
       LEFT JOIN accounts a ON a.id = bs.account_id
       WHERE bs.id = $1`,
      [id]
    );

    return success(updated.rows[0]);
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

    const bankRes = await query(
      `SELECT bs.* FROM banks_safes bs WHERE bs.id = $1 AND bs.company_id = $2`,
      [id, ctx.companyId]
    );

    if (bankRes.rows.length === 0) {
      return notFound();
    }

    const txDepRes = await query(
      `SELECT id FROM cash_transactions WHERE bank_safe_id = $1 LIMIT 1`,
      [id]
    );
    if (txDepRes.rows.length > 0) {
      return error('لا يمكن حذف الخزينة/البنك لأنه مرتبط بحركات نقدية');
    }

    const vouchDepRes = await query(
      `SELECT id FROM voucher_receipts WHERE bank_safe_id = $1 LIMIT 1`,
      [id]
    );
    if (vouchDepRes.rows.length > 0) {
      return error('لا يمكن حذف الخزينة/البنك لأنه مرتبط بسندات قبض');
    }

    const vouchDisDepRes = await query(
      `SELECT id FROM voucher_disbursements WHERE bank_safe_id = $1 LIMIT 1`,
      [id]
    );
    if (vouchDisDepRes.rows.length > 0) {
      return error('لا يمكن حذف الخزينة/البنك لأنه مرتبط بسندات صرف');
    }

    await transaction(async (client) => {
      await client.query(`DELETE FROM banks_safes WHERE id = $1`, [id]);
    });

    return success({ deleted: true });
  } catch (err) {
    return handleApiError(err);
  }
}
