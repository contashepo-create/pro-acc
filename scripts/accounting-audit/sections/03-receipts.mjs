/**
 * Section 03 — Receipt Vouchers (سندات القبض)
 *
 *  - counterpart accounts by receipt type (client→1130, supplier_refund→2110,
 *    general→4200)
 *  - allocation to sales invoices: validation (contact match, status, overpay,
 *    duplicates), paid_amount + status transitions, unapplied remainder to
 *    counterpart
 *  - FIFO auto-allocation of unapplied client receipts
 *  - approval flow: pending => no journal until approved, then posted
 *  - input rejections (amount, reason, contact, bank)
 *  - invariants: vouchers journalized, double-entry, trial balance, numbering
 */
import {
  check, rejects, assertBalance, callRpc,
  invDoubleEntry, invTrialBalance, invVouchersJournalized, invNoDuplicateNumbers,
} from '../framework.mjs';

export const name = '03 Receipt Vouchers (سندات القبض)';

export async function run({ db, A, B }) {
  const { companyId, userId, byCode, banks, safe, contacts } = A;
  const date = '2026-06-12';
  const client = contacts.client;

  /* dedicated client for the FIFO scenario: its invoice queue must contain
     ONLY this section's documents, otherwise earlier sections' leftover
     invoices legitimately absorb the FIFO allocation first. */
  const fifoClient = (await callRpc(db, 'create_contact_atomic', {
    p_company_id: companyId, p_user_id: userId,
    p_data: JSON.stringify({ name: 'عميل FIFO المراجعة', type: 'client', phone: '01099999999' }),
    p_opening_amount: 0, p_opening_type: null,
  })).rows[0].result;
  check('fifo client created', !!fifoClient?.id, JSON.stringify(fifoClient).slice(0, 120));

  /* --- 1. create two unpaid invoices to allocate ---------------------- */
  const mkInv = async (price, qty) => (await callRpc(db, 'create_sales_invoice_atomic', {
    p_company_id: companyId, p_contact_id: client, p_project_id: null,
    p_date: date, p_due_date: '2026-07-12',
    p_items: JSON.stringify([{ description: 'بند سند', quantity: qty, unitPrice: price }]),
    p_vat_rate: 0.15, p_vat_enabled: true, p_notes: null,
    p_collected_amount: 0, p_bank_safe_id: null, p_user_id: userId,
  })).rows[0].result;
  const invA = await mkInv(100, 10); // total 1150
  const invB = await mkInv(100, 5);  // total 575

  /* --- 2. client receipt with exact allocation ------------------------ */
  const rec1 = (await callRpc(db, 'create_voucher_receipt_atomic', {
    p_company_id: companyId, p_date: date, p_receipt_type: 'client', p_contact_id: client,
    p_amount: 1150, p_bank_safe_id: banks, p_reason: 'دفعة أولى',
    p_allocations: JSON.stringify([{ invoice_id: invA.id, amount: 1150 }]),
    p_auto_fifo: false, p_request_approval: false, p_user_id: userId,
  })).rows[0].result;
  check('receipt1 approved + allocated_amount 1150',
    rec1.status === 'approved' && Number(rec1.allocated_amount) === 1150,
    JSON.stringify(rec1).slice(0, 140));
  const invARow = (await db.query('SELECT paid_amount, status FROM invoices WHERE id=$1', [invA.id])).rows[0];
  check('invA paid 1150 => status paid', Number(invARow.paid_amount) === 1150 && invARow.status === 'paid',
    JSON.stringify(invARow));

  /* --- 3. partial allocation leaves remainder on counterpart ----------- */
  const rec2 = (await callRpc(db, 'create_voucher_receipt_atomic', {
    p_company_id: companyId, p_date: date, p_receipt_type: 'client', p_contact_id: client,
    p_amount: 700, p_bank_safe_id: banks, p_reason: 'دفعة جزئية',
    p_allocations: JSON.stringify([{ invoice_id: invB.id, amount: 400 }]),
    p_auto_fifo: false, p_request_approval: false, p_user_id: userId,
  })).rows[0].result;
  const lines2 = await db.query(`
    SELECT a.code, jl.debit, jl.credit FROM journal_lines jl
    JOIN accounts a ON a.id = jl.account_id WHERE jl.journal_entry_id=$1`, [rec2.journal_entry_id]);
  const byAcc2 = Object.fromEntries(lines2.rows.map((r) => [r.code, { d: Number(r.debit), c: Number(r.credit) }]));
  check('receipt2 JE: DR bank 700 / CR AR 700 (allocated+unapplied)',
    byAcc2['1121']?.d === 700 && byAcc2['1130']?.c === 700, JSON.stringify(byAcc2));
  const invBRow = (await db.query('SELECT paid_amount, status FROM invoices WHERE id=$1', [invB.id])).rows[0];
  check('invB partial 400 => status partial', Number(invBRow.paid_amount) === 400 && invBRow.status === 'partial');

  /* --- 4. FIFO auto-allocation (isolated client queue) ------------------ */
  const fifoA = (await callRpc(db, 'create_sales_invoice_atomic', {
    p_company_id: companyId, p_contact_id: fifoClient.id, p_project_id: null,
    p_date: '2026-06-01', p_due_date: '2026-07-01',
    p_items: JSON.stringify([{ description: 'FIFO قديم', quantity: 10, unitPrice: 100 }]),
    p_vat_rate: 0.15, p_vat_enabled: true, p_notes: null,
    p_collected_amount: 0, p_bank_safe_id: null, p_user_id: userId,
  })).rows[0].result;
  const fifoB = (await callRpc(db, 'create_sales_invoice_atomic', {
    p_company_id: companyId, p_contact_id: fifoClient.id, p_project_id: null,
    p_date: '2026-06-05', p_due_date: '2026-07-05',
    p_items: JSON.stringify([{ description: 'FIFO أحدث', quantity: 5, unitPrice: 100 }]),
    p_vat_rate: 0.15, p_vat_enabled: true, p_notes: null,
    p_collected_amount: 0, p_bank_safe_id: null, p_user_id: userId,
  })).rows[0].result;
  // 575 receipt: oldest first -> 1150 cap on fifoA takes all 575 (partial)
  const recFifo1 = (await callRpc(db, 'create_voucher_receipt_atomic', {
    p_company_id: companyId, p_date: date, p_receipt_type: 'client', p_contact_id: fifoClient.id,
    p_amount: 575, p_bank_safe_id: banks, p_reason: 'تسوية FIFO',
    p_allocations: '[]', p_auto_fifo: true, p_request_approval: false, p_user_id: userId,
  })).rows[0].result;
  const fifoARow = (await db.query('SELECT paid_amount, status FROM invoices WHERE id=$1', [fifoA.id])).rows[0];
  const fifoBRow = (await db.query('SELECT paid_amount, status FROM invoices WHERE id=$1', [fifoB.id])).rows[0];
  check('FIFO hits oldest invoice first (575 of 1150 => partial, newest untouched)',
    Number(fifoARow.paid_amount) === 575 && fifoARow.status === 'partial' && Number(fifoBRow.paid_amount) === 0,
    JSON.stringify({ fifoA: fifoARow, fifoB: fifoBRow }));
  // second equal receipt finishes the oldest (575+575=1150), newest untouched
  const recFifo2 = (await callRpc(db, 'create_voucher_receipt_atomic', {
    p_company_id: companyId, p_date: date, p_receipt_type: 'client', p_contact_id: fifoClient.id,
    p_amount: 575, p_bank_safe_id: banks, p_reason: 'إغلاق الأقدم',
    p_allocations: '[]', p_auto_fifo: true, p_request_approval: false, p_user_id: userId,
  })).rows[0].result;
  const fifoARow2 = (await db.query('SELECT paid_amount, status FROM invoices WHERE id=$1', [fifoA.id])).rows[0];
  const fifoBRow2 = (await db.query('SELECT paid_amount, status FROM invoices WHERE id=$1', [fifoB.id])).rows[0];
  check('FIFO: oldest finished at exactly 1150, newest still untouched',
    Number(fifoARow2.paid_amount) === 1150 && fifoARow2.status === 'paid' && Number(fifoBRow2.paid_amount) === 0,
    JSON.stringify({ fifoA: fifoARow2, fifoB: fifoBRow2 }));
  // third receipt spills onto the newest
  const recFifo3 = (await callRpc(db, 'create_voucher_receipt_atomic', {
    p_company_id: companyId, p_date: date, p_receipt_type: 'client', p_contact_id: fifoClient.id,
    p_amount: 575, p_bank_safe_id: banks, p_reason: 'تسوية الأحدث',
    p_allocations: '[]', p_auto_fifo: true, p_request_approval: false, p_user_id: userId,
  })).rows[0].result;
  const fifoBRow3 = (await db.query('SELECT paid_amount, status FROM invoices WHERE id=$1', [fifoB.id])).rows[0];
  check('FIFO spill onto newest: 575 => paid', Number(fifoBRow3.paid_amount) === 575 && fifoBRow3.status === 'paid',
    JSON.stringify({ fifoB: fifoBRow3, unapplied: recFifo3.unapplied_amount }));

  /* --- 5. general + supplier_refund counterparts ------------------------ */
  const recGen = (await callRpc(db, 'create_voucher_receipt_atomic', {
    p_company_id: companyId, p_date: date, p_receipt_type: 'general', p_contact_id: null,
    p_amount: 250, p_bank_safe_id: safe, p_reason: 'إيراد عام من الخزينة',
    p_allocations: '[]', p_auto_fifo: false, p_request_approval: false, p_user_id: userId,
  })).rows[0].result;
  const lines4 = await db.query(`
    SELECT a.code, jl.debit, jl.credit FROM journal_lines jl
    JOIN accounts a ON a.id = jl.account_id WHERE jl.journal_entry_id=$1`, [recGen.journal_entry_id]);
  const byAcc4 = Object.fromEntries(lines4.rows.map((r) => [r.code, { d: Number(r.debit), c: Number(r.credit) }]));
  check('general receipt: DR safe 250 / CR other-income 250',
    byAcc4['1110']?.d === 250 && byAcc4['4200']?.c === 250, JSON.stringify(byAcc4));

  const rec5 = (await callRpc(db, 'create_voucher_receipt_atomic', {
    p_company_id: companyId, p_date: date, p_receipt_type: 'supplier_refund', p_contact_id: contacts.supplier,
    p_amount: 90, p_bank_safe_id: safe, p_reason: 'رد مورد',
    p_allocations: '[]', p_auto_fifo: false, p_request_approval: false, p_user_id: userId,
  })).rows[0].result;
  const lines5 = await db.query(`
    SELECT a.code, jl.debit, jl.credit FROM journal_lines jl
    JOIN accounts a ON a.id = jl.account_id WHERE jl.journal_entry_id=$1`, [rec5.journal_entry_id]);
  const byAcc5 = Object.fromEntries(lines5.rows.map((r) => [r.code, { d: Number(r.debit), c: Number(r.credit) }]));
  check('supplier_refund: DR safe 90 / CR AP 90',
    byAcc5['1110']?.d === 90 && byAcc5['2110']?.c === 90, JSON.stringify(byAcc5));

  /* --- 6. approval flow -------------------------------------------------- */
  const rec6 = (await callRpc(db, 'create_voucher_receipt_atomic', {
    p_company_id: companyId, p_date: date, p_receipt_type: 'client', p_contact_id: client,
    p_amount: 300, p_bank_safe_id: banks, p_reason: 'سند بموافقة',
    p_allocations: '[]', p_auto_fifo: false, p_request_approval: true, p_user_id: userId,
  })).rows[0].result;
  check('approval flow: pending + approval id', rec6.status === 'pending' && !!rec6.approval_id,
    JSON.stringify(rec6).slice(0, 140));
  const preJe = (await db.query('SELECT journal_entry_id FROM voucher_receipts WHERE id=$1', [rec6.id])).rows[0];
  check('pending receipt has NO journal entry yet', preJe.journal_entry_id === null);
  const approved = (await callRpc(db, 'respond_voucher_receipt_approval', {
    p_company_id: companyId, p_approval_id: rec6.approval_id, p_action: 'approve',
    p_approver_user_id: userId, p_approver_chat_id: 'chat-1', p_comments: 'موافق',
  })).rows[0].result;
  check('approve: status approved + journal posted', approved.status === 'approved' && !!approved.journal_entry_id,
    JSON.stringify(approved).slice(0, 140));

  /* --- 7. rejections ------------------------------------------------------- */
  await rejects(callRpc(db, 'create_voucher_receipt_atomic', {
    p_company_id: companyId, p_date: date, p_receipt_type: 'client', p_contact_id: client,
    p_amount: 0, p_bank_safe_id: banks, p_reason: 'صفر',
    p_allocations: '[]', p_auto_fifo: false, p_request_approval: false, p_user_id: userId,
  }), 'zero-amount receipt rejected');

  await rejects(callRpc(db, 'create_voucher_receipt_atomic', {
    p_company_id: companyId, p_date: date, p_receipt_type: 'client', p_contact_id: client,
    p_amount: 10, p_bank_safe_id: banks, p_reason: '',
    p_allocations: '[]', p_auto_fifo: false, p_request_approval: false, p_user_id: userId,
  }), 'empty-reason receipt rejected');

  await rejects(callRpc(db, 'create_voucher_receipt_atomic', {
    p_company_id: companyId, p_date: date, p_receipt_type: 'client', p_contact_id: B.contacts.client,
    p_amount: 10, p_bank_safe_id: banks, p_reason: 'طرف أجنبي',
    p_allocations: '[]', p_auto_fifo: false, p_request_approval: false, p_user_id: userId,
  }), 'cross-tenant contact rejected');

  await rejects(callRpc(db, 'create_voucher_receipt_atomic', {
    p_company_id: companyId, p_date: date, p_receipt_type: 'client', p_contact_id: client,
    p_amount: 10, p_bank_safe_id: B.banks, p_reason: 'بنك أجنبي',
    p_allocations: '[]', p_auto_fifo: false, p_request_approval: false, p_user_id: userId,
  }), 'cross-tenant bank rejected');

  await rejects(callRpc(db, 'create_voucher_receipt_atomic', {
    p_company_id: companyId, p_date: date, p_receipt_type: 'client', p_contact_id: client,
    p_amount: 10, p_bank_safe_id: banks, p_reason: 'تخصيص مكرر',
    p_allocations: JSON.stringify([{ invoice_id: invB.id, amount: 5 }, { invoice_id: invB.id, amount: 5 }]),
    p_auto_fifo: false, p_request_approval: false, p_user_id: userId,
  }), 'duplicate invoice allocation rejected');

  await rejects(callRpc(db, 'create_voucher_receipt_atomic', {
    p_company_id: companyId, p_date: date, p_receipt_type: 'client', p_contact_id: client,
    p_amount: 10, p_bank_safe_id: banks, p_reason: 'تخصيص أكبر',
    p_allocations: JSON.stringify([{ invoice_id: invA.id, amount: 1151 }]),
    p_auto_fifo: false, p_request_approval: false, p_user_id: userId,
  }), 'over-allocation rejected');

  await rejects(callRpc(db, 'create_voucher_receipt_atomic', {
    p_company_id: companyId, p_date: date, p_receipt_type: 'client', p_contact_id: client,
    p_amount: 50, p_bank_safe_id: banks, p_reason: 'تخصيص على محصلة',
    p_allocations: JSON.stringify([{ invoice_id: invA.id, amount: 1 }]),
    p_auto_fifo: false, p_request_approval: false, p_user_id: userId,
  }), 'allocation to a fully paid invoice rejected');

  /* --- 8. invariants -------------------------------------------------------- */
  await invVouchersJournalized(db, companyId);
  await invDoubleEntry(db, companyId);
  await invTrialBalance(db, companyId);
  await invNoDuplicateNumbers(db, companyId, 'voucher_receipts');
}
