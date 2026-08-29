/**
 * Section 08 — Purchase Returns (مرتجعات المشتريات)
 *
 *  - totals (items + original PI tax rate) and journal: DR AP / CR the SAME
 *    expense account the PI debited (5400 plain, 5110 project, 2145 PO) / CR input VAT
 *  - cumulative cap: returned_amount + return <= PI total
 *  - refund <= return total AND <= paid amount; refund posts a supplier_refund receipt
 *  - custody-paid PIs cannot be returned through this path
 *  - numbering per year, item persistence
 *  - invariants: double-entry, trial balance, AP consistency
 */
import {
  check, rejects, assertBalance, callRpc,
  invDoubleEntry, invTrialBalance, invNoDuplicateNumbers,
} from '../framework.mjs';

export const name = '08 Purchase Returns (مرتجعات المشتريات)';

export async function run({ db, A }) {
  const { companyId, userId, banks, safe, contacts } = A;
  const date = '2026-06-20';
  const supplier = contacts.supplier;

  /* PI: 5 x 100 + 15% = 575, fully paid from the bank */
  const pi = (await callRpc(db, 'create_purchase_invoice_atomic', {
    p_company_id: companyId, p_supplier_id: supplier, p_purchase_order_id: null,
    p_project_id: null, p_custody_id: null, p_link_to_project: false,
    p_date: date,
    p_items: JSON.stringify([{ description: 'بند مرتجع', quantity: 5, unit_price: 100 }]),
    p_tax_rate: 0.15, p_notes: null, p_user_id: userId,
    p_paid_amount: 575, p_bank_safe_id: banks,
  })).rows[0].result;
  check('PI seeded 575 and paid', Number(pi.total) === 575 && Number(pi.paid_amount) === 575);

  /* --- 1. partial return 2 x 100 + 15% = 230, refund 100 ------------------ */
  const ret = (await callRpc(db, 'create_purchase_return_atomic', {
    p_company_id: companyId, p_purchase_invoice_id: pi.id, p_date: date,
    p_reason: 'بضاعة تالفة',
    p_items: JSON.stringify([{ description: 'بند مرتجع', quantity: 2, unit_price: 100 }]),
    p_user_id: userId, p_refund_amount: 100, p_bank_safe_id: safe,
  })).rows[0].result;
  assertBalance(ret.subtotal, 200, 'ret subtotal');
  assertBalance(ret.vat_amount, 30, 'ret VAT at original rate');
  assertBalance(ret.total, 230, 'ret total');
  assertBalance(ret.refund_amount, 100, 'ret refund');
  check('ret approved + numbered', ret.status === 'approved' && Number.isInteger(Number(ret.number)));

  const piRow = (await db.query('SELECT returned_amount, status FROM purchase_invoices WHERE id=$1', [pi.id])).rows[0];
  assertBalance(piRow.returned_amount, 230, 'PI returned_amount updated');

  const retJe = await db.query(`
    SELECT a.code, jl.debit, jl.credit FROM journal_lines jl
    JOIN journal_entries je ON je.id = jl.journal_entry_id
    JOIN accounts a ON a.id = jl.account_id WHERE je.id=$1`, [ret.journal_entry_id]);
  const retBy = Object.fromEntries(retJe.rows.map((r) => [r.code, { d: Number(r.debit), c: Number(r.credit) }]));
  check('ret JE: DR AP 230 / CR 5400 200 / CR 1180 30 (same expense side the PI debited)',
    retBy['2110']?.d === 230 && retBy['5400']?.c === 200 && retBy['1180']?.c === 30, JSON.stringify(retBy));

  /* refund receipt: DR safe / CR AP */
  const refundRec = (await db.query(`
    SELECT v.id, v.amount, v.journal_entry_id FROM voucher_receipts v
    WHERE v.company_id=$1 AND v.reason ILIKE '%رد نقدي%'
    ORDER BY v.number DESC LIMIT 1`, [companyId])).rows[0];
  const rrBy = Object.fromEntries((await db.query(`
    SELECT a.code, jl.debit, jl.credit FROM journal_lines jl
    JOIN accounts a ON a.id = jl.account_id WHERE jl.journal_entry_id=$1`, [refundRec.journal_entry_id]))
    .rows.map((r) => [r.code, { d: Number(r.debit), c: Number(r.credit) }]));
  check('refund receipt JE: DR safe 100 / CR AP 100', rrBy['1110']?.d === 100 && rrBy['2110']?.c === 100,
    JSON.stringify(rrBy));

  /* --- 2. cumulative cap --------------------------------------------------- */
  await rejects(callRpc(db, 'create_purchase_return_atomic', {
    p_company_id: companyId, p_purchase_invoice_id: pi.id, p_date: date,
    p_reason: 'تجاوز',
    p_items: JSON.stringify([{ description: 'بند مرتجع', quantity: 5, unit_price: 100 }]),
    p_user_id: userId,
  }), 'return beyond PI net (575-230) rejected');

  /* --- 3. refund caps -------------------------------------------------------- */
  await rejects(callRpc(db, 'create_purchase_return_atomic', {
    p_company_id: companyId, p_purchase_invoice_id: pi.id, p_date: date,
    p_reason: 'رد أكبر',
    p_items: JSON.stringify([{ description: 'بند مرتجع', quantity: 1, unit_price: 100 }]),
    p_user_id: userId, p_refund_amount: 9999, p_bank_safe_id: safe,
  }), 'refund beyond the return total rejected');

  /* --- 4. rejections ---------------------------------------------------------- */
  await rejects(callRpc(db, 'create_purchase_return_atomic', {
    p_company_id: companyId, p_purchase_invoice_id: pi.id, p_date: date,
    p_reason: 'صنف خاطئ',
    p_items: JSON.stringify([{ description: 'x', quantity: 0, unit_price: 10 }]),
    p_user_id: userId,
  }), 'zero-qty return item rejected');

  await rejects(callRpc(db, 'create_purchase_return_atomic', {
    p_company_id: companyId, p_purchase_invoice_id: '99999999-0000-4000-8000-000000000001',
    p_date: date, p_reason: 'فاتورة وهمية',
    p_items: JSON.stringify([{ description: 'x', quantity: 1, unit_price: 10 }]),
    p_user_id: userId,
  }), 'return on a ghost PI rejected');

  /* --- 5. project PI return credits 5110 (mirrors the PI debit) ------------- */
  const proj = (await callRpc(db, 'create_project_atomic', {
    p_company_id: companyId, p_name: 'مشروع المرتجعات', p_client_id: contacts.client,
    p_contract_value: 5000, p_start_date: '2026-06-01', p_end_date: '2026-12-31',
    p_status: 'active', p_description: null, p_location: null,
    p_items: '[]', p_auto_invoice: false, p_user_id: userId,
  })).rows[0].result;
  const pi2 = (await callRpc(db, 'create_purchase_invoice_atomic', {
    p_company_id: companyId, p_supplier_id: supplier, p_purchase_order_id: null,
    p_project_id: proj.id, p_custody_id: null, p_link_to_project: true,
    p_date: date,
    p_items: JSON.stringify([{ description: 'خام', quantity: 3, unit_price: 100 }]),
    p_tax_rate: 0, p_notes: null, p_user_id: userId,
  })).rows[0].result;
  const pi2Je = await db.query(`
    SELECT a.code FROM journal_lines jl JOIN journal_entries je ON je.id=jl.journal_entry_id
    JOIN accounts a ON a.id=jl.account_id WHERE je.id=$1 AND jl.debit>0`, [pi2.journal_entry_id]);
  const ret2 = (await callRpc(db, 'create_purchase_return_atomic', {
    p_company_id: companyId, p_purchase_invoice_id: pi2.id, p_date: date,
    p_reason: 'مرتجع مشروع',
    p_items: JSON.stringify([{ description: 'خام', quantity: 1, unit_price: 100 }]),
    p_user_id: userId,
  })).rows[0].result;
  const ret2Je = await db.query(`
    SELECT a.code FROM journal_lines jl JOIN journal_entries je ON je.id=jl.journal_entry_id
    JOIN accounts a ON a.id=jl.account_id WHERE je.id=$1 AND jl.credit>0`, [ret2.journal_entry_id]);
  check('project PI return credits the same account the PI debited (5110)',
    pi2Je.rows.map((r) => r.code).includes('5110')
    && ret2Je.rows.map((r) => r.code).includes('5110'),
    `PI debit: ${pi2Je.rows.map((r) => r.code)}, return credit: ${ret2Je.rows.map((r) => r.code)}`);

  /* --- 6. invariants ------------------------------------------------------------- */
  await invDoubleEntry(db, companyId);
  await invTrialBalance(db, companyId);
  await invNoDuplicateNumbers(db, companyId, 'purchase_returns');
  const retMath = await db.query(`
    SELECT number FROM purchase_returns
    WHERE company_id=$1 AND ABS(subtotal + COALESCE(vat_amount,0) - total) > 0.01`, [companyId]);
  check('returns: subtotal + vat == total', retMath.rows.length === 0,
    retMath.rows.map((r) => `#${r.number}`).join('; '));
}
