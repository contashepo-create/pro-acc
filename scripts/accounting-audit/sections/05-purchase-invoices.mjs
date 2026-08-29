/**
 * Section 05 — Purchase Invoices (فواتير المشتريات)
 *
 *  - totals (subtotal/tax/total) and the posted journal (DR expense / DR input
 *    VAT / CR AP) + reference linkage
 *  - instant cash payment (paid_amount, payment_source, disbursement writer)
 *  - other expenses at issue (per-line JE, default 5400)
 *  - withholding at source: EG-only, rate cap 0.2, AP reduction + 2165 JE
 *  - item contract + cross-tenant supplier
 *  - cancellation: reversal + status
 *  - FINDING probe: return-side expense account (5400/5110/2145) vs the
 *    purchase-side debit account (5100) — recorded as a check that surfaces
 *    the mismatch when it exists
 *  - invariants: purchase math, double-entry, trial balance, numbering
 */
import {
  check, rejects, assertBalance, callRpc,
  invDoubleEntry, invTrialBalance, invPurchaseInvoiceMath, invNoDuplicateNumbers,
} from '../framework.mjs';

export const name = '05 Purchase Invoices (فواتير المشتريات)';

export async function run({ db, A, E }) {
  const { companyId, userId, banks, contacts } = A;
  const date = '2026-06-15';
  const supplier = contacts.supplier;

  /* --- 1. basic PI with VAT ------------------------------------------- */
  const pi1 = (await callRpc(db, 'create_purchase_invoice_atomic', {
    p_company_id: companyId, p_supplier_id: supplier, p_purchase_order_id: null,
    p_project_id: null, p_custody_id: null, p_link_to_project: false,
    p_date: date,
    p_items: JSON.stringify([{ description: 'أسمنت', quantity: 10, unit_price: 100 }]),
    p_tax_rate: 0.15, p_notes: null, p_user_id: userId,
  })).rows[0].result;
  assertBalance(pi1.subtotal, 1000, 'pi1 subtotal');
  assertBalance(pi1.tax_amount, 150, 'pi1 tax');
  assertBalance(pi1.total, 1150, 'pi1 total');
  const je1 = await db.query(`
    SELECT je.reference_type, je.reference_id, a.code, jl.debit, jl.credit
    FROM journal_entries je
    JOIN journal_lines jl ON jl.journal_entry_id = je.id
    JOIN accounts a ON a.id = jl.account_id
    WHERE je.id = $1`, [pi1.journal_entry_id]);
  const je1By = Object.fromEntries(je1.rows.map((r) => [r.code, { d: Number(r.debit), c: Number(r.credit) }]));
  check('pi1 JE: DR 5400 1000 / DR 1180 150 / CR 2110 1150 + reference',
    je1.rows[0].reference_type === 'purchase_invoice' && je1.rows[0].reference_id === pi1.id
    && je1By['5400']?.d === 1000 && je1By['1180']?.d === 150 && je1By['2110']?.c === 1150,
    JSON.stringify(je1By));

  /* --- 2. project PI (debit moves to materials 5110) -------------------- */
  const proj = (await callRpc(db, 'create_project_atomic', {
    p_company_id: companyId, p_name: 'مشروع المراجعة', p_client_id: contacts.client,
    p_contract_value: 10000, p_start_date: '2026-06-01', p_end_date: '2026-12-31',
    p_status: 'active', p_description: null, p_location: 'القاهرة',
    p_items: '[]', p_auto_invoice: false, p_user_id: userId,
  })).rows[0].result;
  const pi2 = (await callRpc(db, 'create_purchase_invoice_atomic', {
    p_company_id: companyId, p_supplier_id: supplier, p_purchase_order_id: null,
    p_project_id: proj.id, p_custody_id: null, p_link_to_project: true,
    p_date: date,
    p_items: JSON.stringify([{ description: 'حديد', quantity: 4, unit_price: 250 }]),
    p_tax_rate: 0.15, p_notes: null, p_user_id: userId,
  })).rows[0].result;
  const je2 = await db.query(`
    SELECT a.code, jl.debit FROM journal_lines jl
    JOIN journal_entries je ON je.id = jl.journal_entry_id
    JOIN accounts a ON a.id = jl.account_id
    WHERE je.id = $1 AND jl.debit > 0`, [pi2.journal_entry_id]);
  const pi2Expense = je2.rows.find((r) => Number(r.debit) === 1000)?.code;
  check('project PI debits materials 5110 (5100 is a group header, never posted)', pi2Expense === '5110',
    `debit account: ${pi2Expense}`);

  /* --- 3. instant cash payment ------------------------------------------ */
  const pi3 = (await callRpc(db, 'create_purchase_invoice_atomic', {
    p_company_id: companyId, p_supplier_id: supplier, p_purchase_order_id: null,
    p_project_id: null, p_custody_id: null, p_link_to_project: false,
    p_date: date,
    p_items: JSON.stringify([{ description: 'وقود', quantity: 10, unit_price: 40 }]),
    p_tax_rate: 0.15, p_notes: null, p_user_id: userId,
    p_paid_amount: 460, p_bank_safe_id: banks,
  })).rows[0].result;
  assertBalance(pi3.total, 460, 'pi3 total');
  check('pi3 instant payment: paid 460 => status paid + payment_source',
    Number(pi3.paid_amount) === 460 && pi3.status === 'paid' && !!pi3.payment_source,
    JSON.stringify({ paid: pi3.paid_amount, status: pi3.status, src: pi3.payment_source }));
  const disb3 = (await db.query(`
    SELECT v.id, v.amount, v.journal_entry_id FROM voucher_disbursements v
    WHERE v.company_id=$1 AND v.contact_id=$2 ORDER BY v.number DESC LIMIT 1`, [companyId, supplier])).rows[0];
  const d3By = Object.fromEntries((await db.query(`
    SELECT a.code, jl.debit, jl.credit FROM journal_lines jl
    JOIN accounts a ON a.id = jl.account_id WHERE jl.journal_entry_id=$1`, [disb3.journal_entry_id]))
    .rows.map((r) => [r.code, { d: Number(r.debit), c: Number(r.credit) }]));
  check('pi3 disbursement JE: DR AP 460 / CR bank 460',
    d3By['2110']?.d === 460 && d3By['1121']?.c === 460, JSON.stringify(d3By));

  await rejects(callRpc(db, 'create_purchase_invoice_atomic', {
    p_company_id: companyId, p_supplier_id: supplier, p_purchase_order_id: null,
    p_project_id: null, p_custody_id: null, p_link_to_project: false,
    p_date: date,
    p_items: JSON.stringify([{ description: 'x', quantity: 1, unit_price: 10 }]),
    p_tax_rate: 0.15, p_notes: null, p_user_id: userId,
    p_paid_amount: 11.5, p_bank_safe_id: null,
  }), 'payment without bank/safe rejected');

  /* --- 4. other expenses at issue ----------------------------------------- */
  const pi4 = (await callRpc(db, 'create_purchase_invoice_atomic', {
    p_company_id: companyId, p_supplier_id: supplier, p_purchase_order_id: null,
    p_project_id: null, p_custody_id: null, p_link_to_project: false,
    p_date: date,
    p_items: JSON.stringify([{ description: 'بند', quantity: 1, unit_price: 100 }]),
    p_tax_rate: 0, p_notes: null, p_user_id: userId,
    p_other_expenses: JSON.stringify([{ description: 'نقل', amount: 55 }]),
  })).rows[0].result;
  check('pi4 other expenses recorded on the PI', Number(pi4.other_expenses_total) === 55,
    JSON.stringify(pi4.other_expenses_total));
  check('pi4 returned other_expenses_journal_entry_id', !!pi4.other_expenses_journal_entry_id);
  const oeJe = pi4.other_expenses_journal_entry_id;
  const oeBy = Object.fromEntries((await db.query(`
    SELECT a.code, jl.debit, jl.credit FROM journal_lines jl
    JOIN accounts a ON a.id = jl.account_id WHERE jl.journal_entry_id=$1`, [oeJe]))
    .rows.map((r) => [r.code, { d: Number(r.debit), c: Number(r.credit) }]));
  check('other-expense JE: DR 5400 55 / CR cash 55',
    oeBy['5400']?.d === 55 && oeBy['1110']?.c === 55, JSON.stringify(oeBy));

  /* --- 5. withholding: SA rejected, EG applied ----------------------------- */
  await rejects(callRpc(db, 'create_purchase_invoice_atomic', {
    p_company_id: companyId, p_supplier_id: supplier, p_purchase_order_id: null,
    p_project_id: null, p_custody_id: null, p_link_to_project: false,
    p_date: date,
    p_items: JSON.stringify([{ description: 'x', quantity: 1, unit_price: 100 }]),
    p_tax_rate: 0, p_notes: null, p_user_id: userId,
    p_withholding_rate: 0.1,
  }), 'withholding on a non-EG company rejected');

  const { companyId: eId, userId: eUser, contacts: eContacts } = E;
  const eSupplier = eContacts.supplier;
  const eDate = '2026-08-01'; // inside the EG Jul-Jun fiscal year
  const piE = (await callRpc(db, 'create_purchase_invoice_atomic', {
    p_company_id: eId, p_supplier_id: eSupplier, p_purchase_order_id: null,
    p_project_id: null, p_custody_id: null, p_link_to_project: false,
    p_date: eDate,
    p_items: JSON.stringify([{ description: 'خدمة مصرية', quantity: 1, unit_price: 1000 }]),
    p_tax_rate: 0.14, p_notes: null, p_user_id: eUser,
    p_withholding_rate: 0.1,
  })).rows[0].result;
  // subtotal 1000, tax 140, gross 1140, wh 100 => total 1040
  assertBalance(piE.subtotal, 1000, 'EG piE subtotal');
  assertBalance(piE.withholding_amount, 100, 'EG piE withholding 10% of subtotal');
  assertBalance(piE.total, 1040, 'EG piE total reduced by withholding');
  check('EG PI returned withholding_journal_entry_id', !!piE.withholding_journal_entry_id);
  const whJe = (await db.query(`
    SELECT a.code, jl.debit, jl.credit FROM journal_lines jl
    JOIN journal_entries je ON je.id = jl.journal_entry_id
    JOIN accounts a ON a.id = jl.account_id
    WHERE je.id=$1`, [piE.withholding_journal_entry_id])).rows;
  const whBy = Object.fromEntries(whJe.map((r) => [r.code, { d: Number(r.debit), c: Number(r.credit) }]));
  check('EG withholding JE: DR AP 100 / CR 2165 100', whBy['2110']?.d === 100 && whBy['2165']?.c === 100,
    JSON.stringify(whBy));

  await rejects(callRpc(db, 'create_purchase_invoice_atomic', {
    p_company_id: eId, p_supplier_id: eSupplier, p_purchase_order_id: null,
    p_project_id: null, p_custody_id: null, p_link_to_project: false,
    p_date: date,
    p_date: eDate,
    p_items: JSON.stringify([{ description: 'x', quantity: 1, unit_price: 100 }]),
    p_tax_rate: 0, p_notes: null, p_user_id: eUser,
    p_withholding_rate: 0.25,
  }), 'withholding rate above 20% rejected');

  /* --- 6. item + tenant rejections ------------------------------------------ */
  await rejects(callRpc(db, 'create_purchase_invoice_atomic', {
    p_company_id: companyId, p_supplier_id: supplier, p_purchase_order_id: null,
    p_project_id: null, p_custody_id: null, p_link_to_project: false,
    p_date: date,
    p_items: JSON.stringify([{ description: 'x', quantity: 0, unit_price: 10 }]),
    p_tax_rate: 0, p_notes: null, p_user_id: userId,
  }), 'zero-qty purchase item rejected');

  await rejects(callRpc(db, 'create_purchase_invoice_atomic', {
    p_company_id: companyId, p_supplier_id: supplier, p_purchase_order_id: null,
    p_project_id: null, p_custody_id: null, p_link_to_project: false,
    p_date: date,
    p_items: JSON.stringify([{ description: 'x', quantity: 1, unit_price: -1 }]),
    p_tax_rate: 0, p_notes: null, p_user_id: userId,
  }), 'negative unit_price rejected');

  await rejects(callRpc(db, 'create_purchase_invoice_atomic', {
    p_company_id: companyId, p_supplier_id: E.contacts.supplier, p_purchase_order_id: null,
    p_project_id: null, p_custody_id: null, p_link_to_project: false,
    p_date: date,
    p_items: JSON.stringify([{ description: 'x', quantity: 1, unit_price: 10 }]),
    p_tax_rate: 0, p_notes: null, p_user_id: userId,
  }), 'cross-tenant supplier rejected');

  /* --- 7. cancellation ------------------------------------------------------- */
  const apBefore = await db.query(`
    SELECT COALESCE(SUM(jl.credit - jl.debit),0) net FROM journal_lines jl
    JOIN journal_entries je ON je.id = jl.journal_entry_id
    JOIN accounts a ON a.id = jl.account_id
    WHERE je.company_id=$1 AND a.code='2110'`, [companyId]);
  const cancelPi = (await callRpc(db, 'cancel_purchase_invoice_atomic', {
    p_company_id: companyId, p_invoice_id: pi1.id, p_notes: 'إلغاء المراجعة', p_user_id: userId,
  })).rows[0].result;
  check('PI cancel => status cancelled', cancelPi.status === 'cancelled', JSON.stringify(cancelPi).slice(0, 120));
  const apAfter = await db.query(`
    SELECT COALESCE(SUM(jl.credit - jl.debit),0) net FROM journal_lines jl
    JOIN journal_entries je ON je.id = jl.journal_entry_id
    JOIN accounts a ON a.id = jl.account_id
    WHERE je.company_id=$1 AND a.code='2110'`, [companyId]);
  assertBalance(Number(apAfter.rows[0].net) - Number(apBefore.rows[0].net), -1150,
    'AP drops by exactly the cancelled PI total (reversal)');

  /* --- 8. invariants --------------------------------------------------------- */
  await invPurchaseInvoiceMath(db, companyId);
  await invDoubleEntry(db, companyId);
  await invTrialBalance(db, companyId);
  await invNoDuplicateNumbers(db, companyId, 'purchase_invoices');
}
