/**
 * Section 04 — Disbursement Vouchers (سندات الصرف)
 *
 *  - counterpart accounts by type (supplier→2110, employee_advance→1160,
 *    subcontractor→2150, client_refund→1130, general→5400)
 *  - allocation to purchase invoices (net of returns, status checks)
 *  - approval flow (pending => no journal until approved)
 *  - input rejections (amount, bank, employee, allocations)
 *  - invariants: vouchers journalized, double-entry, trial balance, numbering
 */
import {
  check, rejects, assertBalance, callRpc,
  invDoubleEntry, invTrialBalance, invVouchersJournalized, invNoDuplicateNumbers,
} from '../framework.mjs';

export const name = '04 Disbursement Vouchers (سندات الصرف)';

export async function run({ db, A, B }) {
  const { companyId, userId, banks, safe, contacts } = A;
  const date = '2026-06-13';
  const supplier = contacts.supplier;

  /* seed an employee for the advance flow */
  const empId = (await callRpc(db, 'create_employee_atomic', {
    p_company_id: companyId, p_name: 'موظف صرف', p_phone: '01111111111',
    p_email: null, p_salary: 5000, p_department: 'عمليات', p_position: 'عامل',
    p_hire_date: '2025-01-01', p_user_id: userId,
  })).rows[0].result?.id
    || (await db.query(`
      INSERT INTO employees(company_id, name, phone, salary, hire_date, is_active)
      VALUES ($1,'موظف صرف','01111111111',5000,'2025-01-01',TRUE) RETURNING id`, [companyId])).rows[0].id;
  check('employee fixture created', !!empId);

  /* purchase invoice to allocate against */
  const pi = (await callRpc(db, 'create_purchase_invoice_atomic', {
    p_company_id: companyId, p_supplier_id: supplier, p_purchase_order_id: null,
    p_project_id: null, p_custody_id: null, p_link_to_project: false,
    p_date: date, p_items: JSON.stringify([{ description: 'مواد', quantity: 5, unit_price: 200 }]),
    p_tax_rate: 0.15, p_notes: null, p_user_id: userId,
  })).rows[0].result;
  check('purchase invoice seeded (total 1150)', Number(pi.total) === 1150, JSON.stringify(pi).slice(0, 140));

  /* --- 1. supplier disbursement with allocation ------------------------ */
  const d1 = (await callRpc(db, 'create_voucher_disbursement_atomic', {
    p_company_id: companyId, p_date: date, p_disbursement_type: 'supplier',
    p_contact_id: supplier, p_employee_id: null, p_amount: 1150,
    p_bank_safe_id: banks, p_reason: 'سداد فاتورة مورد',
    p_allocations: JSON.stringify([{ invoice_id: pi.id, amount: 1150 }]),
    p_request_approval: false, p_user_id: userId,
  })).rows[0].result;
  const piRow = (await db.query('SELECT paid_amount, status FROM purchase_invoices WHERE id=$1', [pi.id])).rows[0];
  check('disb1 allocated: PI paid 1150 => paid', Number(piRow.paid_amount) === 1150 && piRow.status === 'paid',
    JSON.stringify(piRow));
  const lines1 = await db.query(`
    SELECT a.code, jl.debit, jl.credit FROM journal_lines jl
    JOIN accounts a ON a.id = jl.account_id WHERE jl.journal_entry_id=$1`, [d1.journal_entry_id]);
  const byAcc1 = Object.fromEntries(lines1.rows.map((r) => [r.code, { d: Number(r.debit), c: Number(r.credit) }]));
  check('disb1 JE: DR AP 1150 / CR bank 1150',
    byAcc1['2110']?.d === 1150 && byAcc1['1121']?.c === 1150, JSON.stringify(byAcc1));

  /* --- 2. employee advance --------------------------------------------- */
  const d2 = (await callRpc(db, 'create_voucher_disbursement_atomic', {
    p_company_id: companyId, p_date: date, p_disbursement_type: 'employee_advance',
    p_contact_id: null, p_employee_id: empId, p_amount: 800,
    p_bank_safe_id: safe, p_reason: 'سلفة موظف',
    p_allocations: '[]', p_request_approval: false, p_user_id: userId,
  })).rows[0].result;
  const lines2 = await db.query(`
    SELECT a.code, jl.debit, jl.credit FROM journal_lines jl
    JOIN accounts a ON a.id = jl.account_id WHERE jl.journal_entry_id=$1`, [d2.journal_entry_id]);
  const byAcc2 = Object.fromEntries(lines2.rows.map((r) => [r.code, { d: Number(r.debit), c: Number(r.credit) }]));
  check('employee advance: DR advances 800 / CR safe 800',
    byAcc2['1160']?.d === 800 && byAcc2['1110']?.c === 800, JSON.stringify(byAcc2));

  /* --- 3. client refund --------------------------------------------------- */
  const d3 = (await callRpc(db, 'create_voucher_disbursement_atomic', {
    p_company_id: companyId, p_date: date, p_disbursement_type: 'client_refund',
    p_contact_id: contacts.client, p_employee_id: null, p_amount: 120,
    p_bank_safe_id: safe, p_reason: 'رد عميل',
    p_allocations: '[]', p_request_approval: false, p_user_id: userId,
  })).rows[0].result;
  const lines3 = await db.query(`
    SELECT a.code, jl.debit, jl.credit FROM journal_lines jl
    JOIN accounts a ON a.id = jl.account_id WHERE jl.journal_entry_id=$1`, [d3.journal_entry_id]);
  const byAcc3 = Object.fromEntries(lines3.rows.map((r) => [r.code, { d: Number(r.debit), c: Number(r.credit) }]));
  check('client refund: DR AR 120 / CR safe 120',
    byAcc3['1130']?.d === 120 && byAcc3['1110']?.c === 120, JSON.stringify(byAcc3));

  /* --- 4. general expense ----------------------------------------------- */
  const d4 = (await callRpc(db, 'create_voucher_disbursement_atomic', {
    p_company_id: companyId, p_date: date, p_disbursement_type: 'other',
    p_contact_id: null, p_employee_id: null, p_amount: 60,
    p_bank_safe_id: safe, p_reason: 'مصروف عام',
    p_allocations: '[]', p_request_approval: false, p_user_id: userId,
  })).rows[0].result;
  const lines4 = await db.query(`
    SELECT a.code, jl.debit, jl.credit FROM journal_lines jl
    JOIN accounts a ON a.id = jl.account_id WHERE jl.journal_entry_id=$1`, [d4.journal_entry_id]);
  const byAcc4 = Object.fromEntries(lines4.rows.map((r) => [r.code, { d: Number(r.debit), c: Number(r.credit) }]));
  check('general disbursement: DR expense 60 / CR safe 60',
    byAcc4['5400']?.d === 60 && byAcc4['1110']?.c === 60, JSON.stringify(byAcc4));

  /* --- 5. approval flow ---------------------------------------------------- */
  const d5 = (await callRpc(db, 'create_voucher_disbursement_atomic', {
    p_company_id: companyId, p_date: date, p_disbursement_type: 'other',
    p_contact_id: null, p_employee_id: null, p_amount: 45,
    p_bank_safe_id: safe, p_reason: 'سند صرف بموافقة',
    p_allocations: '[]', p_request_approval: true, p_user_id: userId,
  })).rows[0].result;
  check('disb pending + approval id', d5.status === 'pending' && !!d5.approval_id, JSON.stringify(d5).slice(0, 120));
  const preJe = (await db.query('SELECT journal_entry_id FROM voucher_disbursements WHERE id=$1', [d5.id])).rows[0];
  check('pending disbursement has NO journal yet', preJe.journal_entry_id === null);
  const ap = (await callRpc(db, 'respond_voucher_disbursement_approval', {
    p_company_id: companyId, p_approval_id: d5.approval_id, p_action: 'approve',
    p_approver_user_id: userId, p_approver_chat_id: 'chat-1', p_comments: 'موافق',
  })).rows[0].result;
  check('disb approved + journal posted', ap.status === 'approved' && !!ap.journal_entry_id, JSON.stringify(ap).slice(0, 120));

  /* --- 6. rejections -------------------------------------------------------- */
  await rejects(callRpc(db, 'create_voucher_disbursement_atomic', {
    p_company_id: companyId, p_date: date, p_disbursement_type: 'supplier',
    p_contact_id: supplier, p_employee_id: null, p_amount: -1,
    p_bank_safe_id: banks, p_reason: 'موجب فقط',
    p_allocations: '[]', p_request_approval: false, p_user_id: userId,
  }), 'negative amount rejected');

  await rejects(callRpc(db, 'create_voucher_disbursement_atomic', {
    p_company_id: companyId, p_date: date, p_disbursement_type: 'supplier',
    p_contact_id: B.contacts.supplier, p_employee_id: null, p_amount: 10,
    p_bank_safe_id: banks, p_reason: 'مورد أجنبي',
    p_allocations: '[]', p_request_approval: false, p_user_id: userId,
  }), 'cross-tenant supplier rejected');

  await rejects(callRpc(db, 'create_voucher_disbursement_atomic', {
    p_company_id: companyId, p_date: date, p_disbursement_type: 'supplier',
    p_contact_id: supplier, p_employee_id: null, p_amount: 10,
    p_bank_safe_id: B.banks, p_reason: 'بنك أجنبي',
    p_allocations: '[]', p_request_approval: false, p_user_id: userId,
  }), 'cross-tenant bank rejected');

  await rejects(callRpc(db, 'create_voucher_disbursement_atomic', {
    p_company_id: companyId, p_date: date, p_disbursement_type: 'supplier',
    p_contact_id: supplier, p_employee_id: null, p_amount: 1151,
    p_bank_safe_id: banks, p_reason: 'تخصيص يتجاوز',
    p_allocations: JSON.stringify([{ invoice_id: pi.id, amount: 1151 }]),
    p_request_approval: false, p_user_id: userId,
  }), 'allocation beyond net remaining rejected');

  await rejects(callRpc(db, 'create_voucher_disbursement_atomic', {
    p_company_id: companyId, p_date: date, p_disbursement_type: 'supplier',
    p_contact_id: supplier, p_employee_id: null, p_amount: 5,
    p_bank_safe_id: banks, p_reason: 'تخصيص على محصلة',
    p_allocations: JSON.stringify([{ invoice_id: pi.id, amount: 5 }]),
    p_request_approval: false, p_user_id: userId,
  }), 'allocation to fully paid PI rejected');

  await rejects(callRpc(db, 'create_voucher_disbursement_atomic', {
    p_company_id: companyId, p_date: date, p_disbursement_type: 'employee_advance',
    p_contact_id: null, p_employee_id: '99999999-0000-4000-8000-000000000001', p_amount: 5,
    p_bank_safe_id: safe, p_reason: 'موظف وهمي',
    p_allocations: '[]', p_request_approval: false, p_user_id: userId,
  }), 'ghost employee rejected');

  /* --- 7. invariants --------------------------------------------------------- */
  await invVouchersJournalized(db, companyId);
  await invDoubleEntry(db, companyId);
  await invTrialBalance(db, companyId);
  await invNoDuplicateNumbers(db, companyId, 'voucher_disbursements');
}
