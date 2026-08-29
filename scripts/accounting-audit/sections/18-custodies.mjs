/**
 * Section 18 — Custody Files (العُهد / ملفات العهدة)
 *
 * Engine: 049 (open/add/expense/settle/cancel v49 internals), 056 (tenant
 * guard wrappers + update_custody_metadata_atomic + guards), 057 (settle
 * wrapper chain), 108 (purchase invoice on custody 1150 with 5110/5400 +
 * 1180, pay_purchase_invoice_from_custody Dr 2110/Cr 1150, cancel that
 * reverses every addition/receipt JE). 012 (trigger-maintained
 * total_received/total_expenses/remaining_amount + custody_invoices +
 * vw_custody_files).
 * Accounting semantics under audit:
 *   - open_custody_file: Dr 1150 / Cr bank; file عهدة-YYYY-NNNN; 'addition'
 *     tx; amount = total_received = remaining.
 *   - add_custody_funds: open only; Dr 1150 / Cr bank; 'addition' tx.
 *   - post_custody_expense: Dr expense amount / Cr 1150 from-custody /
 *     Cr 2140 excess (allow_excess); 'expense' (+ 'adjustment') tx.
 *   - purchase invoice with custody: paid + payment_source='custody';
 *     Dr 5110/5400 + Dr 1180 / Cr 1150 total; 'expense' tx + custody_invoices.
 *   - pay_purchase_invoice_from_custody: Dr 2110 / Cr 1150; partial→paid;
 *     'expense' tx.
 *   - settle_custody_file: returned ≤ remaining; Dr bank cash / Dr 1160
 *     shortage / Cr 1150; 'return' + 'shortage' tx; employee_advances row
 *     (custody_shortage); status settled, remaining 0.
 *   - cancel_custody_file (108): open + no expense txs; reverses each
 *     addition/receipt JE (ref custody_reversal); zeros the file.
 *   - Trigger invariants: remaining = total_received − total_expenses.
 */
import { callRpc, check, assertBalance, rejects, seedTenant, invDoubleEntry, invTrialBalance } from '../framework.mjs';

export const name = '18 Custody Files (ملفات العهدة)';

const openFile = (db, A, date, amount) => callRpc(db, 'open_custody_file', {
  p_company_id: A.companyId, p_employee_id: A.emp, p_date: date, p_amount: amount,
  p_reason: 'عهدة موقع', p_bank_safe_id: A.banks, p_project_id: null, p_created_by: A.userId,
});

export async function run({ db }) {
  {
    const A = await seedTenant(db, { name: 'مراجعة 18', email: 'audit18@example.test' });
    const { companyId, userId, byCode } = A;
    A.emp = (await callRpc(db, 'create_employee_atomic', {
      p_company_id: companyId, p_name: 'أمين العهدة', p_phone: '05518181818',
      p_email: null, p_salary: 5000, p_department: 'مالية', p_position: 'كاشير',
      p_hire_date: '2026-01-01', p_user_id: userId,
    })).rows[0].result.id;

    /* --- opening ------------------------------------------------------------------ */
    await rejects(openFile(db, A, '2026-07-15', 0), 'zero custody amount is rejected', 'غير صالح');
    const f1 = (await openFile(db, A, '2026-07-15', 10000)).rows[0].result;
    check('file number عهدة-2026-0001', f1.file_number === 'عهدة-2026-0001', f1.file_number);
    check('file open with full amounts', f1.status === 'open' && Number(f1.amount) === 10000 && Number(f1.remaining_amount) === 10000,
      JSON.stringify({ s: f1.status, a: f1.amount, r: f1.remaining_amount }));
    const openJe = (await db.query(`
      SELECT a.code, SUM(jl.debit - jl.credit) net FROM journal_lines jl
      JOIN journal_entries je ON je.id=jl.journal_entry_id JOIN accounts a ON a.id=jl.account_id
      WHERE je.id=$1 GROUP BY a.code`, [f1.journal_entry_id])).rows;
    const onet = Object.fromEntries(openJe.map((r) => [r.code, Number(r.net)]));
    assertBalance(onet['1150'], 10000, 'opening JE Dr custody 1150');
    assertBalance(onet['1121'], -10000, 'opening JE Cr bank 1121');
    const oref = (await db.query(`SELECT reference_type FROM journal_entries WHERE id=$1`, [f1.journal_entry_id])).rows[0];
    check('opening JE reference_type=custody', oref.reference_type === 'custody', oref.reference_type);
    const ot = (await db.query(
      `SELECT type, amount FROM custody_transactions WHERE custody_id=$1 AND company_id=$2`, [f1.id, companyId])).rows;
    check('one opening addition tx', ot.length === 1 && ot[0].type === 'addition' && Number(ot[0].amount) === 10000, JSON.stringify(ot));

    /* --- addition ------------------------------------------------------------------- */
    const add = (await callRpc(db, 'add_custody_funds', {
      p_company_id: companyId, p_custody_id: f1.id, p_date: '2026-07-20', p_amount: 2000,
      p_description: 'تعزيز نقدي', p_bank_safe_id: A.banks, p_created_by: userId,
    })).rows[0].result;
    check('addition raises remaining to 12000', Number(add.remaining_amount) === 12000 && Number(add.total_received) === 12000,
      JSON.stringify({ r: add.remaining_amount, tr: add.total_received }));
    const ajNet = Object.fromEntries((await db.query(`
      SELECT a.code, SUM(jl.debit - jl.credit) net FROM journal_lines jl
      JOIN journal_entries je ON je.id=jl.journal_entry_id JOIN accounts a ON a.id=jl.account_id
      WHERE je.id=$1 GROUP BY a.code`, [add.journal_entry_id])).rows.map((r) => [r.code, Number(r.net)]));
    assertBalance(ajNet['1150'], 2000, 'addition JE Dr 1150');
    assertBalance(ajNet['1121'], -2000, 'addition JE Cr bank');
    await rejects(callRpc(db, 'add_custody_funds', {
      p_company_id: companyId, p_custody_id: f1.id, p_date: '2026-07-21', p_amount: -5,
      p_description: null, p_bank_safe_id: A.banks, p_created_by: userId,
    }), 'negative addition is rejected', 'غير صالح');

    /* --- expense within remaining ------------------------------------------------------ */
    const e1 = (await callRpc(db, 'post_custody_expense', {
      p_company_id: companyId, p_custody_id: f1.id, p_date: '2026-08-01', p_amount: 3000,
      p_description: 'مشتريات موقع', p_expense_account_id: byCode['5400'], p_project_id: null,
      p_allow_excess: false, p_invoice_id: null, p_purchase_invoice_id: null, p_created_by: userId,
    })).rows[0].result;
    check('expense leaves 9000 remaining', Number(e1.remaining_amount) === 9000 && Number(e1.applied_from_custody) === 3000,
      JSON.stringify({ r: e1.remaining_amount, f: e1.applied_from_custody }));
    const e1Net = Object.fromEntries((await db.query(`
      SELECT a.code, SUM(jl.debit - jl.credit) net FROM journal_lines jl
      JOIN journal_entries je ON je.id=jl.journal_entry_id JOIN accounts a ON a.id=jl.account_id
      WHERE je.id=$1 GROUP BY a.code`, [e1.journal_entry_id])).rows.map((r) => [r.code, Number(r.net)]));
    assertBalance(e1Net['5400'], 3000, 'expense JE Dr 5400');
    assertBalance(e1Net['1150'], -3000, 'expense JE Cr 1150');

    /* --- excess expense (allow_excess) --------------------------------------------------- */
    await rejects(callRpc(db, 'post_custody_expense', {
      p_company_id: companyId, p_custody_id: f1.id, p_date: '2026-08-04', p_amount: 10000,
      p_description: 'مشتريات كبيرة', p_expense_account_id: byCode['5400'], p_project_id: null,
      p_allow_excess: false, p_invoice_id: null, p_purchase_invoice_id: null, p_created_by: userId,
    }), 'expense above remaining without allow_excess is rejected', 'أكبر من رصيد العهدة');
    const e2 = (await callRpc(db, 'post_custody_expense', {
      p_company_id: companyId, p_custody_id: f1.id, p_date: '2026-08-05', p_amount: 10000,
      p_description: 'مشتريات كبيرة', p_expense_account_id: byCode['5400'], p_project_id: null,
      p_allow_excess: true, p_invoice_id: null, p_purchase_invoice_id: null, p_created_by: userId,
    })).rows[0].result;
    check('excess split 9000 custody + 1000 accrued', Number(e2.applied_from_custody) === 9000 && Number(e2.excess) === 1000,
      JSON.stringify({ f: e2.applied_from_custody, x: e2.excess }));
    const e2Net = Object.fromEntries((await db.query(`
      SELECT a.code, SUM(jl.debit - jl.credit) net FROM journal_lines jl
      JOIN journal_entries je ON je.id=jl.journal_entry_id JOIN accounts a ON a.id=jl.account_id
      WHERE je.id=$1 GROUP BY a.code`, [e2.journal_entry_id])).rows.map((r) => [r.code, Number(r.net)]));
    assertBalance(e2Net['5400'], 10000, 'excess JE Dr 5400 full amount');
    assertBalance(e2Net['1150'], -9000, 'excess JE Cr 1150 remaining only');
    assertBalance(e2Net['2140'], -1000, 'excess JE Cr 2140 accrued to employee');
    check('remaining drained to zero', Number(e2.remaining_amount) === 0 && Number(e2.total_expenses) === 12000,
      JSON.stringify({ r: e2.remaining_amount, te: e2.total_expenses }));

    /* --- top up, then purchase invoice charged to custody --------------------------------- */
    (await callRpc(db, 'add_custody_funds', {
      p_company_id: companyId, p_custody_id: f1.id, p_date: '2026-08-10', p_amount: 5000,
      p_description: 'تعزيز', p_bank_safe_id: A.banks, p_created_by: userId,
    }));
    const inv = (await callRpc(db, 'create_purchase_invoice_atomic', {
      p_company_id: companyId, p_supplier_id: A.contacts.supplier, p_purchase_order_id: null,
      p_project_id: null, p_custody_id: f1.id, p_link_to_project: true, p_date: '2026-08-12',
      p_items: [{ description: 'حديد', quantity: 1, unit_price: 2000 }],
      p_tax_rate: 0.15, p_notes: null, p_user_id: userId,
    })).rows[0].result;
    check('custody invoice is paid with source custody', inv.status === 'paid' && inv.payment_source === 'custody' && Number(inv.paid_amount) === 2300,
      JSON.stringify({ s: inv.status, ps: inv.payment_source, p: inv.paid_amount }));
    const invNet = Object.fromEntries((await db.query(`
      SELECT a.code, SUM(jl.debit - jl.credit) net FROM journal_lines jl
      JOIN journal_entries je ON je.id=jl.journal_entry_id JOIN accounts a ON a.id=jl.account_id
      WHERE je.id=$1 GROUP BY a.code`, [inv.journal_entry_id])).rows.map((r) => [r.code, Number(r.net)]));
    assertBalance(invNet['5400'], 2000, 'custody invoice Dr 5400 (no project)');
    assertBalance(invNet['1180'], 300, 'custody invoice Dr 1180 VAT');
    assertBalance(invNet['1150'], -2300, 'custody invoice Cr 1150 total');
    const cinv = (await db.query(
      `SELECT count(*)::int c, SUM(amount) s FROM custody_invoices WHERE custody_id=$1 AND purchase_invoice_id=$2`,
      [f1.id, inv.id])).rows[0];
    check('custody_invoices link row (2300)', cinv.c === 1 && Number(cinv.s) === 2300, JSON.stringify(cinv));
    await rejects(callRpc(db, 'create_purchase_invoice_atomic', {
      p_company_id: companyId, p_supplier_id: A.contacts.supplier, p_purchase_order_id: null,
      p_project_id: null, p_custody_id: f1.id, p_link_to_project: true, p_date: '2026-08-13',
      p_items: [{ description: 'خرسانة', quantity: 1, unit_price: 4000 }],
      p_tax_rate: 0, p_notes: null, p_user_id: userId,
    }), 'custody invoice above remaining is rejected', 'أكبر من المتبقي في ملف العهدة');

    /* --- pay an AP invoice from custody (partial then full) -------------------------------- */
    const apInv = (await callRpc(db, 'create_purchase_invoice_atomic', {
      p_company_id: companyId, p_supplier_id: A.contacts.supplier, p_purchase_order_id: null,
      p_project_id: null, p_custody_id: null, p_link_to_project: false, p_date: '2026-08-14',
      p_items: [{ description: 'أسمنت', quantity: 1, unit_price: 1000 }],
      p_tax_rate: 0, p_notes: null, p_user_id: userId,
    })).rows[0].result;
    check('AP invoice starts unpaid', apInv.status === 'unpaid' && apInv.payment_source === 'ap',
      JSON.stringify({ s: apInv.status, ps: apInv.payment_source }));
    const p1 = (await callRpc(db, 'pay_purchase_invoice_from_custody', {
      p_company_id: companyId, p_custody_id: f1.id, p_purchase_invoice_id: apInv.id,
      p_amount: 600, p_date: '2026-08-20', p_created_by: userId,
    })).rows[0].result;
    check('partial payment → invoice partial', p1.invoice_status === 'partial' && Number(p1.paid_amount) === 600,
      JSON.stringify({ s: p1.invoice_status, p: p1.paid_amount }));
    const p1Net = Object.fromEntries((await db.query(`
      SELECT a.code, SUM(jl.debit - jl.credit) net FROM journal_lines jl
      JOIN journal_entries je ON je.id=jl.journal_entry_id JOIN accounts a ON a.id=jl.account_id
      WHERE je.id=$1 GROUP BY a.code`, [p1.journal_entry_id])).rows.map((r) => [r.code, Number(r.net)]));
    assertBalance(p1Net['2110'], 600, 'custody AP payment Dr 2110');
    assertBalance(p1Net['1150'], -600, 'custody AP payment Cr 1150');
    const p2 = (await callRpc(db, 'pay_purchase_invoice_from_custody', {
      p_company_id: companyId, p_custody_id: f1.id, p_purchase_invoice_id: apInv.id,
      p_amount: 400, p_date: '2026-08-25', p_created_by: userId,
    })).rows[0].result;
    check('final payment → invoice paid', p2.invoice_status === 'paid', p2.invoice_status);
    check('custody remaining after payments = 1700', Number(p2.remaining_amount) === 1700, String(p2.remaining_amount));
    await rejects(callRpc(db, 'pay_purchase_invoice_from_custody', {
      p_company_id: companyId, p_custody_id: f1.id, p_purchase_invoice_id: apInv.id,
      p_amount: 10, p_date: '2026-08-26', p_created_by: userId,
    }), 'paying a paid invoice is rejected', 'غير صالحة للسداد');
    await rejects(callRpc(db, 'pay_purchase_invoice_from_custody', {
      p_company_id: companyId, p_custody_id: f1.id, p_purchase_invoice_id: inv.id,
      p_amount: 100, p_date: '2026-08-26', p_created_by: userId,
    }), 'paying an already-paid custody invoice is rejected', 'غير صالحة للسداد');

    /* --- metadata patching ------------------------------------------------------------- */
    const meta = (await callRpc(db, 'update_custody_metadata_atomic', {
      p_company_id: companyId, p_custody_id: f1.id,
      p_patch: { reason: 'عهدة موقع أ', notes: 'ملاحظة مراجعة' }, p_user_id: userId,
    })).rows[0].result;
    check('metadata patch applied', meta.reason === 'عهدة موقع أ' && meta.notes === 'ملاحظة مراجعة',
      JSON.stringify({ r: meta.reason, n: meta.notes }));
    await rejects(callRpc(db, 'update_custody_metadata_atomic', {
      p_company_id: companyId, p_custody_id: f1.id, p_patch: { amount: 5 }, p_user_id: userId,
    }), 'patching a financial field is rejected', 'غير صالحة');

    /* --- settlement with cash return + shortage ------------------------------------------ */
    await rejects(callRpc(db, 'settle_custody_file', {
      p_company_id: companyId, p_custody_id: f1.id, p_date: '2026-09-01', p_returned_cash: 2000,
      p_bank_safe_id: A.banks, p_description: null, p_created_by: userId,
    }), 'return above remaining is rejected', 'أكبر من رصيد العهدة');
    const st = (await callRpc(db, 'settle_custody_file', {
      p_company_id: companyId, p_custody_id: f1.id, p_date: '2026-09-01', p_returned_cash: 1000,
      p_bank_safe_id: A.banks, p_description: 'إغلاق نهائي', p_created_by: userId,
    })).rows[0].result;
    check('settlement: returned 1000, shortage 700', Number(st.returned_cash) === 1000 && Number(st.shortage) === 700
      && st.status === 'settled' && Number(st.remaining_amount) === 0, JSON.stringify({ s: st.status, r: st.returned_cash, sh: st.shortage }));
    const stNet = Object.fromEntries((await db.query(`
      SELECT a.code, SUM(jl.debit - jl.credit) net FROM journal_lines jl
      JOIN journal_entries je ON je.id=jl.journal_entry_id JOIN accounts a ON a.id=jl.account_id
      WHERE je.id=$1 GROUP BY a.code`, [st.journal_entry_id])).rows.map((r) => [r.code, Number(r.net)]));
    assertBalance(stNet['1121'], 1000, 'settlement Dr bank cash returned');
    assertBalance(stNet['1160'], 700, 'settlement Dr 1160 shortage');
    assertBalance(stNet['1150'], -1700, 'settlement Cr 1150 full remaining');
    const adv = (await db.query(
      `SELECT count(*)::int c, SUM(amount) amount, SUM(remaining_amount) remaining_amount
       FROM employee_advances
       WHERE custody_id=$1 AND company_id=$2 AND type='custody_shortage'`, [f1.id, companyId])).rows[0];
    check('shortage recorded as employee advance', adv.c === 1 && Number(adv.amount) === 700 && Number(adv.remaining_amount) === 700, JSON.stringify(adv));
    await rejects(callRpc(db, 'settle_custody_file', {
      p_company_id: companyId, p_custody_id: f1.id, p_date: '2026-09-02', p_returned_cash: 0,
      p_bank_safe_id: A.banks, p_description: null, p_created_by: userId,
    }), 'settling a settled file is rejected', 'مغلق');

    /* --- cancellation reverses every addition/receipt JE ----------------------------------- */
    const f2 = (await openFile(db, A, '2026-09-05', 3000)).rows[0].result;
    check('second file numbered 0002', f2.file_number === 'عهدة-2026-0002', f2.file_number);
    const add2 = (await callRpc(db, 'add_custody_funds', {
      p_company_id: companyId, p_custody_id: f2.id, p_date: '2026-09-10', p_amount: 1000,
      p_description: 'تعزيز', p_bank_safe_id: A.banks, p_created_by: userId,
    })).rows[0].result;
    check('file 2 remaining 4000 before cancel', Number(add2.remaining_amount) === 4000, String(add2.remaining_amount));
    const cx = (await callRpc(db, 'cancel_custody_file', {
      p_company_id: companyId, p_custody_id: f2.id, p_created_by: userId,
    })).rows[0].result;
    check('cancel marks settled and returns reversal', cx.cancelled === true && cx.status === 'settled' && !!cx.reversal_journal_id,
      JSON.stringify({ c: cx.cancelled, s: cx.status, r: !!cx.reversal_journal_id }));
    check('cancelled file fully zeroed', Number(cx.amount) === 0 && Number(cx.total_received) === 0 && Number(cx.total_expenses) === 0,
      JSON.stringify({ a: cx.amount, tr: cx.total_received, te: cx.total_expenses }));
    check('notes tagged [ملغى]', (cx.notes || '').includes('[ملغى]'), String(cx.notes));
    const f2tx = (await db.query(`SELECT count(*)::int c FROM custody_transactions WHERE custody_id=$1`, [f2.id])).rows[0].c;
    check('addition/receipt txs removed on cancel', f2tx === 0, String(f2tx));
    const revJes = (await db.query(
      `SELECT count(*)::int c FROM journal_entries WHERE reference_type='custody_reversal' AND reference_id=$1`,
      [f2.id])).rows[0];
    check('two reversal JEs (opening + addition)', revJes.c === 2, JSON.stringify(revJes));
    const c1150 = (await db.query(`
      SELECT SUM(jl.debit - jl.credit) net FROM journal_lines jl
      JOIN journal_entries je ON je.id=jl.journal_entry_id JOIN accounts a ON a.id=jl.account_id
      WHERE je.company_id=$1 AND a.code='1150' AND (
        je.reference_id=$2 OR je.reference_type='custody_reversal' AND je.reference_id=$2
      )`, [companyId, f2.id])).rows[0];
    assertBalance(c1150.net, 0, 'custody account nets to zero after cancellation');

    /* --- cancel blocked once expenses exist --------------------------------------------- */
    const f3 = (await openFile(db, A, '2026-09-20', 2000)).rows[0].result;
    (await callRpc(db, 'post_custody_expense', {
      p_company_id: companyId, p_custody_id: f3.id, p_date: '2026-09-21', p_amount: 500,
      p_description: 'نثريات', p_expense_account_id: byCode['5400'], p_project_id: null,
      p_allow_excess: false, p_invoice_id: null, p_purchase_invoice_id: null, p_created_by: userId,
    }));
    await rejects(callRpc(db, 'cancel_custody_file', {
      p_company_id: companyId, p_custody_id: f3.id, p_created_by: userId,
    }), 'cancel with expenses is rejected', 'لا يمكن إلغاؤه');
    const st3 = (await callRpc(db, 'settle_custody_file', {
      p_company_id: companyId, p_custody_id: f3.id, p_date: '2026-09-25', p_returned_cash: 0,
      p_bank_safe_id: A.banks, p_description: null, p_created_by: userId,
    })).rows[0].result;
    check('zero-cash settlement books the full shortage', Number(st3.shortage) === 1500 && st3.status === 'settled',
      JSON.stringify({ sh: st3.shortage, s: st3.status }));
    const st3Net = Object.fromEntries((await db.query(`
      SELECT a.code, SUM(jl.debit - jl.credit) net FROM journal_lines jl
      JOIN journal_entries je ON je.id=jl.journal_entry_id JOIN accounts a ON a.id=jl.account_id
      WHERE je.id=$1 GROUP BY a.code`, [st3.journal_entry_id])).rows.map((r) => [r.code, Number(r.net)]));
    assertBalance(st3Net['1160'], 1500, 'zero-cash settlement Dr 1160 1500');
    check('zero-cash settlement has no bank line', !('1121' in st3Net), JSON.stringify(st3Net));

    /* --- trigger invariant + summary view ------------------------------------------------- */
    const bal = (await db.query(`
      SELECT count(*)::int c FROM custodies WHERE company_id=$1 AND deleted_at IS NULL
      AND remaining_amount <> total_received - total_expenses`, [companyId])).rows[0].c;
    check('remaining = received − expenses on every file', bal === 0, String(bal));
    const vw = (await db.query(
      `SELECT employee_name, original_amount, transaction_count, status FROM vw_custody_files
       WHERE company_id=$1 ORDER BY file_number`, [companyId])).rows;
    check('vw_custody_files lists the three files', vw.length === 3 && vw[0].employee_name === 'أمين العهدة',
      JSON.stringify(vw.map((r) => r.status)));
    check('view transaction counts match', vw[0].transaction_count >= 6 && vw[1].transaction_count === 0,
      JSON.stringify(vw.map((r) => r.transaction_count)));

    /* --- invariants ------------------------------------------------------------------------- */
    await invDoubleEntry(db, companyId);
    await invTrialBalance(db, companyId);
  }
}
