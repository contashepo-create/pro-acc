/**
 * Section 06 — Credit & Debit Notes (الإشعارات الدائنة والمدينة)
 *
 *  - credit note: DR revenue / DR output VAT / CR AR; cumulative cap against
 *    invoice net (original + debits - approved credits); refund <= paid
 *  - debit note: mirror (DR AR / CR revenue / CR VAT); instant collection
 *    requires the parent invoice
 *  - notes extend the invoice: net total grows with debit notes and shrinks
 *    with credit notes (invoice_net_total)
 *  - cancelling a paid/cancelled invoice with approved notes is blocked
 *  - cancellation of a note reverses its journal
 *  - invariants: note math, double-entry, trial balance, numbering
 */
import {
  check, rejects, assertBalance, callRpc,
  invDoubleEntry, invTrialBalance, invNoDuplicateNumbers,
} from '../framework.mjs';

export const name = '06 Credit & Debit Notes (الإشعارات)';

export async function run({ db, A }) {
  const { companyId, userId, banks } = A;
  const date = '2026-06-18';
  // dedicated client: reversal JEs of earlier sections are dated the day they
  // run, so any date-window isolation would leak — isolate by contact instead.
  const noteClient = (await callRpc(db, 'create_contact_atomic', {
    p_company_id: companyId, p_user_id: userId,
    p_data: JSON.stringify({ name: 'عميل الإشعارات المراجعة', type: 'client', phone: '01088888888' }),
    p_opening_amount: 0, p_opening_type: null,
  })).rows[0].result;
  check('note client created', !!noteClient?.id);
  const client = noteClient.id;

  /* parent invoice: 10 x 100 = 1000, VAT 150, total 1150, half collected */
  const inv = (await callRpc(db, 'create_sales_invoice_atomic', {
    p_company_id: companyId, p_contact_id: client, p_project_id: null,
    p_date: date, p_due_date: '2026-07-18',
    p_items: JSON.stringify([{ description: 'بند الإشعارات', quantity: 10, unitPrice: 100 }]),
    p_vat_rate: 0.15, p_vat_enabled: true, p_notes: null,
    p_collected_amount: 575, p_bank_safe_id: banks, p_user_id: userId,
  })).rows[0].result;
  check('parent invoice 1150, half collected', Number(inv.total) === 1150 && Number(inv.paid_amount) === 575);

  /* --- 1. credit note for 2 items (200 + 30 VAT = 230) ------------------ */
  const cn = (await callRpc(db, 'create_credit_note_atomic', {
    p_company_id: companyId, p_invoice_id: inv.id, p_project_id: null, p_contact_id: null,
    p_date: date, p_reason: 'خصم جودة',
    p_items: JSON.stringify([{ description: 'إرجاع بند', quantity: 2, unit_price: 100 }]),
    p_tax_rate: null, p_user_id: userId,
  })).rows[0].result;
  assertBalance(cn.subtotal, 200, 'cn subtotal');
  assertBalance(cn.vat_amount, 30, 'cn VAT from invoice rate');
  assertBalance(cn.total, 230, 'cn total');
  check('cn note_type=credit approved', cn.note_type === 'credit' && cn.status === 'approved');
  const cnJe = await db.query(`
    SELECT a.code, jl.debit, jl.credit FROM journal_lines jl
    JOIN journal_entries je ON je.id = jl.journal_entry_id
    JOIN accounts a ON a.id = jl.account_id WHERE je.id=$1`, [cn.journal_entry_id]);
  const cnBy = Object.fromEntries(cnJe.rows.map((r) => [r.code, { d: Number(r.debit), c: Number(r.credit) }]));
  check('cn JE: DR revenue 200 / DR VAT 30 / CR AR 230',
    cnBy['4100']?.d === 200 && cnBy['2120']?.d === 30 && cnBy['1130']?.c === 230, JSON.stringify(cnBy));

  /* invoice net is now 1150 - 230 = 920 */
  const net1 = (await db.query('SELECT invoice_net_total($1,$2) net', [companyId, inv.id])).rows[0].net;
  assertBalance(net1, 920, 'invoice net after credit note (1150-230)');

  /* --- 2. debit note for 1 item (100 + 15 = 115) ------------------------- */
  const dn = (await callRpc(db, 'create_debit_note_atomic', {
    p_company_id: companyId, p_invoice_id: inv.id, p_project_id: null, p_contact_id: null,
    p_date: date, p_reason: 'مستحقات إضافية',
    p_items: JSON.stringify([{ description: 'نقل إضافي', quantity: 1, unit_price: 100 }]),
    p_tax_rate: null, p_user_id: userId,
  })).rows[0].result;
  assertBalance(dn.total, 115, 'dn total');
  check('dn note_type=debit', dn.note_type === 'debit');
  const dnJe = await db.query(`
    SELECT a.code, jl.debit, jl.credit FROM journal_lines jl
    JOIN journal_entries je ON je.id = jl.journal_entry_id
    JOIN accounts a ON a.id = jl.account_id WHERE je.id=$1`, [dn.journal_entry_id]);
  const dnBy = Object.fromEntries(dnJe.rows.map((r) => [r.code, { d: Number(r.debit), c: Number(r.credit) }]));
  check('dn JE: DR AR 115 / CR revenue 100 / CR VAT 15',
    dnBy['1130']?.d === 115 && dnBy['4100']?.c === 100 && dnBy['2120']?.c === 15, JSON.stringify(dnBy));

  const net2 = (await db.query('SELECT invoice_net_total($1,$2) net', [companyId, inv.id])).rows[0].net;
  assertBalance(net2, 1035, 'invoice net after debit note (920+115)');

  /* --- 3. cumulative cap: a note beyond the net is rejected -------------- */
  await rejects(callRpc(db, 'create_credit_note_atomic', {
    p_company_id: companyId, p_invoice_id: inv.id, p_project_id: null, p_contact_id: null,
    p_date: date, p_reason: 'تجاوز',
    p_items: JSON.stringify([{ description: 'كبير', quantity: 10, unit_price: 100 }]),
    p_tax_rate: 0.15, p_user_id: userId,
  }), 'credit note beyond the invoice net rejected');

  /* --- 4. refund rules ---------------------------------------------------- */
  await rejects(callRpc(db, 'create_credit_note_atomic', {
    p_company_id: companyId, p_invoice_id: inv.id, p_project_id: null, p_contact_id: null,
    p_date: date, p_reason: 'رد أكبر من المحصل',
    p_items: JSON.stringify([{ description: 'بند', quantity: 1, unit_price: 100 }]),
    p_tax_rate: 0.15, p_user_id: userId,
    p_refund_amount: 9999, p_bank_safe_id: banks,
  }), 'refund beyond paid_amount rejected');

  await rejects(callRpc(db, 'create_credit_note_atomic', {
    p_company_id: companyId, p_invoice_id: inv.id, p_project_id: null, p_contact_id: null,
    p_date: date, p_reason: 'رد بدون بنك',
    p_items: JSON.stringify([{ description: 'بند', quantity: 1, unit_price: 10 }]),
    p_tax_rate: 0.15, p_user_id: userId,
    p_refund_amount: 10, p_bank_safe_id: null,
  }), 'refund without bank/safe rejected');

  const cnRefund = (await callRpc(db, 'create_credit_note_atomic', {
    p_company_id: companyId, p_invoice_id: inv.id, p_project_id: null, p_contact_id: null,
    p_date: date, p_reason: 'رد جزئي نقدي',
    p_items: JSON.stringify([{ description: 'بند', quantity: 1, unit_price: 100 }]),
    p_tax_rate: 0.15, p_user_id: userId,
    p_refund_amount: 115, p_bank_safe_id: banks,
  })).rows[0].result;
  check('cn with refund 115 accepted (<= paid 575)', Number(cnRefund.refund_amount) === 115);
  const arNet = await db.query(`
    SELECT COALESCE(SUM(jl.debit - jl.credit),0) net FROM journal_lines jl
    JOIN journal_entries je ON je.id = jl.journal_entry_id
    JOIN accounts a ON a.id = jl.account_id
    WHERE je.company_id=$1 AND a.code='1130' AND jl.contact_id=$2 AND je.date>=$3::date`,
    [companyId, client, date]);
  // net invoice = 1150 - 230 + 115 - 115 = 920; net paid = 575 - 115 refund = 460
  // (the cash refund unwinds part of the collection: DR AR / CR bank)
  if (process.env.AUDIT_DEBUG) {
    const dbg = await db.query(`SELECT je.number, je.date, je.description, jl.debit, jl.credit
      FROM journal_lines jl JOIN journal_entries je ON je.id=jl.journal_entry_id
      JOIN accounts a ON a.id=jl.account_id
      WHERE je.company_id=$1 AND a.code='1130' AND jl.contact_id=$2 AND je.date>=$3::date
      ORDER BY je.number`, [companyId, client, date]);
    console.log('DEBUG AR lines:', JSON.stringify(dbg.rows));
  }
  assertBalance(arNet.rows[0].net, 460, 'client AR = net invoice (920) - net paid (460)');

  /* --- 5. debit-note instant collection requires parent invoice ----------- */
  await rejects(callRpc(db, 'create_debit_note_atomic', {
    p_company_id: companyId, p_invoice_id: null, p_project_id: null, p_contact_id: client,
    p_date: date, p_reason: 'تحصيل بلا أصل',
    p_items: JSON.stringify([{ description: 'بند', quantity: 1, unit_price: 100 }]),
    p_tax_rate: 0.15, p_user_id: userId,
    p_collected_amount: 50, p_bank_safe_id: banks,
  }), 'debit-note instant collection without parent invoice rejected');

  /* --- 6. note on cancelled invoice --------------------------------------- */
  const invC = (await callRpc(db, 'create_sales_invoice_atomic', {
    p_company_id: companyId, p_contact_id: client, p_project_id: null,
    p_date: date, p_due_date: date,
    p_items: JSON.stringify([{ description: 'سيتم إلغاؤها', quantity: 1, unitPrice: 100 }]),
    p_vat_rate: 0.15, p_vat_enabled: true, p_notes: null,
    p_collected_amount: 0, p_bank_safe_id: null, p_user_id: userId,
  })).rows[0].result;
  await callRpc(db, 'cancel_sales_invoice_atomic', {
    p_company_id: companyId, p_invoice_id: invC.id, p_notes: 'x', p_user_id: userId,
  });
  await rejects(callRpc(db, 'create_credit_note_atomic', {
    p_company_id: companyId, p_invoice_id: invC.id, p_project_id: null, p_contact_id: null,
    p_date: date, p_reason: 'على ملغاة',
    p_items: JSON.stringify([{ description: 'بند', quantity: 1, unit_price: 10 }]),
    p_tax_rate: 0.15, p_user_id: userId,
  }), 'credit note on a cancelled invoice rejected');

  /* --- 7. cancel a credit note: journal reverses --------------------------- */
  const arBefore = (await db.query(`
    SELECT COALESCE(SUM(jl.debit - jl.credit),0) net FROM journal_lines jl
    JOIN journal_entries je ON je.id = jl.journal_entry_id
    JOIN accounts a ON a.id = jl.account_id
    WHERE je.company_id=$1 AND a.code='1130'`, [companyId])).rows[0].net;
  const netBefore = (await db.query('SELECT invoice_net_total($1,$2) net', [companyId, inv.id])).rows[0].net;
  const cancelCn = (await callRpc(db, 'cancel_credit_note_atomic', {
    p_company_id: companyId, p_credit_note_id: cn.id, p_user_id: userId,
  })).rows[0].result;
  check('credit note cancelled', cancelCn.status === 'cancelled', JSON.stringify(cancelCn).slice(0, 120));
  const arAfter = (await db.query(`
    SELECT COALESCE(SUM(jl.debit - jl.credit),0) net FROM journal_lines jl
    JOIN journal_entries je ON je.id = jl.journal_entry_id
    JOIN accounts a ON a.id = jl.account_id
    WHERE je.company_id=$1 AND a.code='1130'`, [companyId])).rows[0].net;
  assertBalance(Number(arAfter) - Number(arBefore), 230,
    'AR grows back by the cancelled credit-note total');
  const netAfter = (await db.query('SELECT invoice_net_total($1,$2) net', [companyId, inv.id])).rows[0].net;
  assertBalance(Number(netAfter) - Number(netBefore), 230,
    'invoice net grows back by exactly the cancelled credit-note total');

  /* --- 8. invariants --------------------------------------------------------- */
  await invDoubleEntry(db, companyId);
  await invTrialBalance(db, companyId);
  await invNoDuplicateNumbers(db, companyId, 'credit_notes');
  const noteMath = await db.query(`
    SELECT number, note_type FROM credit_notes
    WHERE company_id=$1 AND deleted_at IS NULL
      AND ABS(subtotal + vat_amount - total) > 0.01`, [companyId]);
  check('notes: subtotal + vat == total for every note', noteMath.rows.length === 0,
    noteMath.rows.map((r) => `#${r.number}(${r.note_type})`).join('; '));
}
