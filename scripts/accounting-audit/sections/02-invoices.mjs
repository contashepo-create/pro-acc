/**
 * Section 02 — Sales Invoices (فواتير المبيعات)
 *
 *  - invoice math (subtotal with per-line discount, VAT, total)
 *  - the posted journal (DR AR / CR revenue / CR VAT) + reference linkage
 *  - on-invoice collection (reused receipt writer): partial/full, paid_amount,
 *    status transitions, over-collection & missing-safe rejection
 *  - item contract (qty>0, price>=0, description, 200-line cap, 2dp)
 *  - stock consumption: quantity drop, 'issue' transaction with continuity,
 *    COGS journal (DR expense / CR inventory), over-issue rejection
 *  - cancellation: reversal JEs (revenue + COGS), stock restock 'return',
 *    paid-invoice cancellation rejection, idempotent second cancel
 *  - invariants: invoice math, VAT rate, double-entry, trial balance, numbering
 */
import {
  check, rejects, assertBalance, callRpc,
  invDoubleEntry, invTrialBalance, invInvoiceMath, invVatRate, invNoDuplicateNumbers,
} from '../framework.mjs';

export const name = '02 Sales Invoices (فواتير المبيعات)';

export async function run({ db, A }) {
  const { companyId, userId, byCode, banks, contacts } = A;
  const date = '2026-06-10';
  const client = contacts.client;

  /* --- 1. basic invoice: line discount + VAT ------------------------- */
  const inv1 = (await callRpc(db, 'create_sales_invoice_atomic', {
    p_company_id: companyId, p_contact_id: client, p_project_id: null,
    p_date: date, p_due_date: '2026-07-10',
    p_items: JSON.stringify([
      { description: 'خدمة تصميم', quantity: 10, unitPrice: 100, discount: 10 },
      { description: 'مستلزمات', quantity: 2, unitPrice: 50 },
    ]),
    p_vat_rate: 0.15, p_vat_enabled: true, p_notes: null,
    p_collected_amount: 0, p_bank_safe_id: null, p_user_id: userId,
  })).rows[0].result;
  // subtotal = round(1000 - 100) + 100 = 1000 ; vat = 150 ; total = 1150
  assertBalance(inv1.subtotal, 1000, 'inv1 subtotal with line discount');
  assertBalance(inv1.vat_amount, 150, 'inv1 VAT @15%');
  assertBalance(inv1.total, 1150, 'inv1 total');
  check('inv1 status unpaid + numbered', inv1.status === 'unpaid' && Number.isInteger(Number(inv1.number)),
    `status=${inv1.status} number=${inv1.number}`);

  // journal: DR 1130 1150 / CR 4100 1000 / CR 2120 150
  const je = await db.query(`
    SELECT je.reference_type, je.reference_id, jl.account_id, a.code, jl.debit, jl.credit
    FROM journal_lines jl
    JOIN journal_entries je ON je.id = jl.journal_entry_id
    JOIN accounts a ON a.id = jl.account_id
    WHERE je.id = $1`, [inv1.journal_entry_id]);
  const byAcc = Object.fromEntries(je.rows.map((r) => [r.code, { d: Number(r.debit), c: Number(r.credit) }]));
  check('inv1 JE linked by reference', je.rows.length > 0
    && je.rows[0].reference_type === 'invoice' && je.rows[0].reference_id === inv1.id);
  check('inv1 JE lines: DR AR 1150 / CR revenue 1000 / CR VAT 150',
    (byAcc['1130']?.d === 1150) && (byAcc['4100']?.c === 1000) && (byAcc['2120']?.c === 150),
    JSON.stringify(byAcc));

  /* --- 2. VAT-disabled invoice --------------------------------------- */
  const inv2 = (await callRpc(db, 'create_sales_invoice_atomic', {
    p_company_id: companyId, p_contact_id: client, p_project_id: null,
    p_date: date, p_due_date: '2026-07-10',
    p_items: JSON.stringify([{ description: 'خدمة بلا ضريبة', quantity: 4, unitPrice: 25 }]),
    p_vat_rate: 0.15, p_vat_enabled: false, p_notes: null,
    p_collected_amount: 0, p_bank_safe_id: null, p_user_id: userId,
  })).rows[0].result;
  assertBalance(inv2.vat_amount, 0, 'inv2 VAT disabled');
  assertBalance(inv2.total, 100, 'inv2 total');
  const je2v = await db.query(`SELECT 1 FROM journal_lines jl JOIN accounts a ON a.id=jl.account_id
    WHERE jl.journal_entry_id=$1 AND a.code='2120'`, [inv2.journal_entry_id]);
  check('inv2 JE has no VAT line', je2v.rows.length === 0);

  /* --- 3. partial collection on creation ------------------------------ */
  const inv3 = (await callRpc(db, 'create_sales_invoice_atomic', {
    p_company_id: companyId, p_contact_id: client, p_project_id: null,
    p_date: date, p_due_date: '2026-07-10',
    p_items: JSON.stringify([{ description: 'بند', quantity: 1, unitPrice: 1000 }]),
    p_vat_rate: 0.15, p_vat_enabled: true, p_notes: null,
    p_collected_amount: 500, p_bank_safe_id: banks, p_user_id: userId,
  })).rows[0].result;
  assertBalance(inv3.paid_amount, 500, 'inv3 partial paid_amount');
  check('inv3 status partial', inv3.status === 'partial', inv3.status);
  check('inv3 returned voucher_receipt_id', !!inv3.voucher_receipt_id);
  const rec3 = (await db.query(`
    SELECT v.amount, v.bank_safe_id, v.journal_entry_id
    FROM voucher_receipts v WHERE v.id = $1`, [inv3.voucher_receipt_id])).rows[0];
  const recLines = await db.query(`
    SELECT a.code, jl.debit, jl.credit FROM journal_lines jl
    JOIN accounts a ON a.id = jl.account_id
    WHERE jl.journal_entry_id = $1`, [rec3.journal_entry_id]);
  const recByAcc = Object.fromEntries(recLines.rows.map((r) => [r.code, { d: Number(r.debit), c: Number(r.credit) }]));
  check('inv3 collection JE: DR bank 500 / CR AR 500',
    recByAcc['1121']?.d === 500 && recByAcc['1130']?.c === 500, JSON.stringify(recByAcc));

  /* --- 4. full collection --------------------------------------------- */
  const inv4 = (await callRpc(db, 'create_sales_invoice_atomic', {
    p_company_id: companyId, p_contact_id: client, p_project_id: null,
    p_date: date, p_due_date: '2026-07-10',
    p_items: JSON.stringify([{ description: 'بند', quantity: 2, unitPrice: 100 }]),
    p_vat_rate: 0.15, p_vat_enabled: true, p_notes: null,
    p_collected_amount: 230, p_bank_safe_id: banks, p_user_id: userId,
  })).rows[0].result;
  assertBalance(inv4.total, 230, 'inv4 total');
  check('inv4 fully collected => paid', inv4.status === 'paid' && Number(inv4.paid_amount) === 230,
    `status=${inv4.status} paid=${inv4.paid_amount}`);

  /* --- 5. rejections --------------------------------------------------- */
  await rejects(callRpc(db, 'create_sales_invoice_atomic', {
    p_company_id: companyId, p_contact_id: client, p_project_id: null,
    p_date: date, p_due_date: date,
    p_items: JSON.stringify([{ description: 'x', quantity: 1, unitPrice: 100 }]),
    p_vat_rate: 0.15, p_vat_enabled: true, p_notes: null,
    p_collected_amount: 99999, p_bank_safe_id: banks, p_user_id: userId,
  }), 'over-collection rejected');

  await rejects(callRpc(db, 'create_sales_invoice_atomic', {
    p_company_id: companyId, p_contact_id: client, p_project_id: null,
    p_date: date, p_due_date: date,
    p_items: JSON.stringify([{ description: 'x', quantity: 1, unitPrice: 100 }]),
    p_vat_rate: 0.15, p_vat_enabled: true, p_notes: null,
    p_collected_amount: 10, p_bank_safe_id: null, p_user_id: userId,
  }), 'collection without bank/safe rejected');

  await rejects(callRpc(db, 'create_sales_invoice_atomic', {
    p_company_id: companyId, p_contact_id: client, p_project_id: null,
    p_date: date, p_due_date: date,
    p_items: '[]', p_vat_rate: 0.15, p_vat_enabled: true, p_notes: null,
    p_collected_amount: 0, p_bank_safe_id: null, p_user_id: userId,
  }), 'empty items rejected');

  await rejects(callRpc(db, 'create_sales_invoice_atomic', {
    p_company_id: companyId, p_contact_id: client, p_project_id: null,
    p_date: date, p_due_date: date,
    p_items: JSON.stringify([{ description: 'x', quantity: 0, unitPrice: 100 }]),
    p_vat_rate: 0.15, p_vat_enabled: true, p_notes: null,
    p_collected_amount: 0, p_bank_safe_id: null, p_user_id: userId,
  }), 'zero-quantity item rejected');

  await rejects(callRpc(db, 'create_sales_invoice_atomic', {
    p_company_id: companyId, p_contact_id: client, p_project_id: null,
    p_date: date, p_due_date: date,
    p_items: JSON.stringify([{ description: 'x', quantity: 1, unitPrice: -5 }]),
    p_vat_rate: 0.15, p_vat_enabled: true, p_notes: null,
    p_collected_amount: 0, p_bank_safe_id: null, p_user_id: userId,
  }), 'negative unit price rejected');

  await rejects(callRpc(db, 'create_sales_invoice_atomic', {
    p_company_id: companyId, p_contact_id: client, p_project_id: null,
    p_date: date, p_due_date: date,
    p_items: JSON.stringify([{ description: '', quantity: 1, unitPrice: 5 }]),
    p_vat_rate: 0.15, p_vat_enabled: true, p_notes: null,
    p_collected_amount: 0, p_bank_safe_id: null, p_user_id: userId,
  }), 'item without description rejected');

  await rejects(callRpc(db, 'create_sales_invoice_atomic', {
    p_company_id: companyId, p_contact_id: '99999999-0000-4000-8000-000000000001', p_project_id: null,
    p_date: date, p_due_date: date,
    p_items: JSON.stringify([{ description: 'x', quantity: 1, unitPrice: 5 }]),
    p_vat_rate: 0.15, p_vat_enabled: true, p_notes: null,
    p_collected_amount: 0, p_bank_safe_id: null, p_user_id: userId,
  }), 'ghost contact rejected');

  /* --- 6. stock + COGS -------------------------------------------------- */
  const item = (await callRpc(db, 'create_inventory_item_atomic', {
    p_company_id: companyId, p_code: 'ITM-01', p_name: 'صندوق اختبار', p_unit: 'قطعة',
    p_warehouse_id: A.warehouse, p_category: 'مستهلكات', p_user_id: userId,
  })).rows[0].result;
  const add = (await callRpc(db, 'post_inventory_movement_atomic', {
    p_company_id: companyId, p_item_id: item.id, p_warehouse_id: A.warehouse,
    p_type: 'add', p_quantity: 100, p_unit_price: 40, p_date: date, p_notes: 'استلام أولي',
    p_to_warehouse_id: null, p_user_id: userId,
  })).rows[0].result;
  check('stock add recorded (100 @ 40)', !!(add.id || add.transaction?.id), JSON.stringify(add).slice(0, 120));

  const inv5 = (await callRpc(db, 'create_sales_invoice_atomic', {
    p_company_id: companyId, p_contact_id: client, p_project_id: null,
    p_date: date, p_due_date: '2026-07-10',
    p_items: JSON.stringify([{ description: 'صندوق اختبار', quantity: 10, unitPrice: 100, inventory_item_id: item.id }]),
    p_vat_rate: 0.15, p_vat_enabled: true, p_notes: null,
    p_collected_amount: 0, p_bank_safe_id: null, p_user_id: userId,
  })).rows[0].result;
  assertBalance(inv5.subtotal, 1000, 'inv5 subtotal');

  const qty = (await db.query('SELECT quantity FROM inventory_items WHERE id=$1', [item.id])).rows[0];
  assertBalance(qty.quantity, 90, 'stock dropped to 90 after issue');
  const issueTxn = (await db.query(`
    SELECT type, quantity, unit_price, total_value, balance_before, balance_after,
           reference_type, reference_id
    FROM inventory_transactions WHERE item_id=$1 AND type='issue' ORDER BY id`, [item.id])).rows[0];
  check('issue transaction recorded with continuity',
    issueTxn.balance_before == 100 && issueTxn.balance_after == 90
    && issueTxn.reference_type === 'invoice' && issueTxn.reference_id === inv5.id
    && Number(issueTxn.total_value) === 400,
    JSON.stringify(issueTxn));
  const cogs = await db.query(`
    SELECT je.reference_type, a.code, jl.debit, jl.credit
    FROM journal_entries je
    JOIN journal_lines jl ON jl.journal_entry_id = je.id
    JOIN accounts a ON a.id = jl.account_id
    WHERE je.company_id=$1 AND je.reference_type='invoice_cogs' AND je.reference_id=$2`,
    [companyId, inv5.id]);
  const cogsByAcc = Object.fromEntries(cogs.rows.map((r) => [r.code, { d: Number(r.debit), c: Number(r.credit) }]));
  check('COGS JE: DR expense 400 / CR inventory 400',
    cogsByAcc['5100']?.d === 400 && cogsByAcc['1170']?.c === 400, JSON.stringify(cogsByAcc));

  await rejects(callRpc(db, 'create_sales_invoice_atomic', {
    p_company_id: companyId, p_contact_id: client, p_project_id: null,
    p_date: date, p_due_date: date,
    p_items: JSON.stringify([{ description: 'صندوق اختبار', quantity: 1000, unitPrice: 100, inventory_item_id: item.id }]),
    p_vat_rate: 0.15, p_vat_enabled: true, p_notes: null,
    p_collected_amount: 0, p_bank_safe_id: null, p_user_id: userId,
  }), 'over-issue beyond stock rejected');

  /* --- 7. cancellation --------------------------------------------------- */
  const arBefore = await db.query(`
    SELECT COALESCE(SUM(jl.debit - jl.credit),0) net
    FROM journal_lines jl
    JOIN journal_entries je ON je.id = jl.journal_entry_id
    JOIN accounts a ON a.id = jl.account_id
    WHERE je.company_id=$1 AND a.code='1130'`, [companyId]);
  const inv1After = (await db.query('SELECT status FROM invoices WHERE id=$1', [inv1.id])).rows[0];
  const cancel = (await callRpc(db, 'cancel_sales_invoice_atomic', {
    p_company_id: companyId, p_invoice_id: inv1.id, p_notes: 'إلغاء اختبار', p_user_id: userId,
  })).rows[0].result;
  check('cancel succeeds -> status cancelled', cancel.status === 'cancelled' && inv1After.status === 'unpaid',
    JSON.stringify(cancel).slice(0, 100));
  // cancellation is a non-destructive offset: the original debit stays, the
  // reversal credit cancels it — AR drops by exactly the invoice total.
  const arAfter = await db.query(`
    SELECT COALESCE(SUM(jl.debit - jl.credit),0) net
    FROM journal_lines jl
    JOIN journal_entries je ON je.id = jl.journal_entry_id
    JOIN accounts a ON a.id = jl.account_id
    WHERE je.company_id=$1 AND a.code='1130'`, [companyId]);
  assertBalance(arAfter.rows[0].net, Number(arBefore.rows[0].net) - Number(inv1.total),
    'AR drops by exactly the cancelled invoice total (reversal offsets original)');
  const revLink = (await db.query(`
    SELECT je2.id FROM journal_entries je1
    JOIN journal_entries je2 ON je2.reversal_of = je1.id
    WHERE je1.id = $1`, [inv1.journal_entry_id])).rows;
  check('reversal JE linked via reversal_of', revLink.length === 1);

  await rejects(callRpc(db, 'cancel_sales_invoice_atomic', {
    p_company_id: companyId, p_invoice_id: inv3.id, p_notes: 'إلغاء على تحصيل', p_user_id: userId,
  }), 'cancelling a collected invoice rejected');

  const cancel2 = (await callRpc(db, 'cancel_sales_invoice_atomic', {
    p_company_id: companyId, p_invoice_id: inv1.id, p_notes: 'إلغاء مكرر', p_user_id: userId,
  })).rows[0].result;
  check('second cancel idempotent', cancel2.already_processed === true, JSON.stringify(cancel2));

  // cancellation of the stock invoice restores inventory + reverses COGS
  await callRpc(db, 'cancel_sales_invoice_atomic', {
    p_company_id: companyId, p_invoice_id: inv5.id, p_notes: 'إلغاء فاتورة مخزون', p_user_id: userId,
  });
  const qtyAfter = (await db.query('SELECT quantity FROM inventory_items WHERE id=$1', [item.id])).rows[0];
  assertBalance(qtyAfter.quantity, 100, 'stock restored to 100 after cancellation');
  const retTxn = (await db.query(`
    SELECT type, quantity, balance_before, balance_after
    FROM inventory_transactions WHERE item_id=$1 AND type='return' ORDER BY id DESC LIMIT 1`, [item.id])).rows[0];
  check('restock "return" transaction with continuity',
    retTxn && Number(retTxn.balance_before) === 90 && Number(retTxn.balance_after) === 100,
    JSON.stringify(retTxn));
  const cogsNet = await db.query(`
    SELECT COALESCE(SUM(jl.debit - jl.credit),0) net
    FROM journal_lines jl
    JOIN journal_entries je ON je.id = jl.journal_entry_id
    JOIN accounts a ON a.id = jl.account_id
    WHERE je.company_id=$1 AND a.code IN ('5100','1170')
      AND (je.reference_type='invoice_cogs' OR je.reference_type='invoice_cogs_reversal') AND je.reference_id=$2`,
    [companyId, inv5.id]);
  assertBalance(cogsNet.rows[0].net, 0, 'COGS nets to zero after cancellation');

  /* --- 8. invariants ------------------------------------------------------ */
  await invInvoiceMath(db, companyId);
  await invVatRate(db, companyId);
  await invDoubleEntry(db, companyId);
  await invTrialBalance(db, companyId);
  await invNoDuplicateNumbers(db, companyId, 'invoices');
}
