/**
 * Section 14 — Multicurrency & Realized FX (العملات المتعددة — IAS 21)
 *
 * Engine: 009 (currencies table), 049 (save_currency + registration base seed),
 * 097 (currency-aware sales invoices + receipt FX gain/loss, both the direct
 * and the approval paths).
 * Accounting semantics under audit:
 *   - save_currency: rate > 0, base currency forced to rate 1, exactly one
 *     base per company (demoting the only base is rejected, promoting a new
 *     one demotes the old).
 *   - FX sales invoice: recorded in the document currency's raw amounts,
 *     invoice row carries currency_code + exchange_rate; JE lines tagged
 *     currency_id/exchange_rate.
 *     PRODUCT NOTE (documented, not a break of double entry): amounts are
 *     never converted into base — amount_in_base_currency equals the raw
 *     amount, so trial-balance "base" figures mix currencies.
 *   - Realized FX on settlement (direct + approval paths): when a receipt
 *     settles an FX invoice at a different rate:
 *       fx     = alloc × (receipt_rate − invoice_rate) / receipt_rate
 *       relief = alloc − fx  (the AR write-off, keeping AR at the recording rate)
 *       JE: Dr bank amount | Cr AR (unallocated + relief) | Cr 4210 fx (gain,
 *       rate up) or Dr 5450 |fx| (loss, rate down).
 *       PRODUCT NOTE: the invoice flips to 'paid' but AR retains a residual
 *       balance equal to fx (the gain/loss is parked in 4210/5450 while AR
 *       carries the difference) — a permanent ghost AR balance per FX
 *       settlement.
 */
import { callRpc, check, assertBalance, rejects, seedTenant, invDoubleEntry, invTrialBalance } from '../framework.mjs';

export const name = '14 Multicurrency (العملات المتعددة)';

export async function run({ db }) {
  {
    const A = await seedTenant(db, { name: 'مراجعة 14', email: 'audit14@example.test' });
    const { companyId, userId, byCode } = A;
    const date = '2026-07-15';
    const client = A.contacts.client;

    /* --- currency master ------------------------------------------------------- */
    let base = (await db.query(`SELECT code, rate, is_base FROM currencies WHERE company_id=$1 AND is_base`, [companyId])).rows[0];
    if (!base) {
      // register_company may leave the currency master empty — the first
      // currency saved as base must establish it at rate 1.
      const cur = A.cfg.currency;
      const baseId0 = (await callRpc(db, 'save_currency', {
        p_company_id: companyId, p_id: null, p_code: cur, p_name: cur, p_rate: 1, p_is_base: true,
      })).rows[0].result;
      base = (await db.query(`SELECT code, rate, is_base FROM currencies WHERE id=$1`, [baseId0])).rows[0];
      check('first base currency saved at forced rate 1', base && Number(base.rate) === 1, JSON.stringify(base));
    } else {
      check('registration seeded exactly one base currency at rate 1', Number(base.rate) === 1, JSON.stringify(base));
    }
    await callRpc(db, 'save_currency', { p_company_id: companyId, p_id: null, p_code: 'USD', p_name: 'دولار', p_rate: 3.75, p_is_base: false });
    await callRpc(db, 'save_currency', { p_company_id: companyId, p_id: null, p_code: 'EUR', p_name: 'يورو', p_rate: 4, p_is_base: false });
    const usdId = (await db.query(`SELECT id FROM currencies WHERE company_id=$1 AND code='USD'`, [companyId])).rows[0].id;
    const count = (await db.query(`SELECT count(*)::int c FROM currencies WHERE company_id=$1`, [companyId])).rows[0].c;
    check('two FX currencies added', count === 3, String(count));

    await rejects(callRpc(db, 'save_currency', { p_company_id: companyId, p_id: null, p_code: 'GBP', p_name: 'جنيه إسترليني', p_rate: 0, p_is_base: false }),
      'non-positive rate is rejected', 'invalid currency');
    const baseId = (await db.query(`SELECT id FROM currencies WHERE company_id=$1 AND is_base`, [companyId])).rows[0].id;
    await rejects(callRpc(db, 'save_currency', { p_company_id: companyId, p_id: baseId, p_code: base.code, p_name: base.code, p_rate: 1, p_is_base: false }),
      'demoting the only base currency is rejected', 'base currency');
    await callRpc(db, 'save_currency', { p_company_id: companyId, p_id: usdId, p_code: 'USD', p_name: 'دولار', p_rate: 3.75, p_is_base: true });
    let bases = (await db.query(`SELECT count(*)::int c FROM currencies WHERE company_id=$1 AND is_base`, [companyId])).rows[0].c;
    const usdNow = (await db.query(`SELECT rate FROM currencies WHERE company_id=$1 AND code='USD'`, [companyId])).rows[0];
    check('promoting a new base keeps exactly one base, forced rate 1', bases === 1 && Number(usdNow.rate) === 1, JSON.stringify({ bases, usdNow }));
    await callRpc(db, 'save_currency', { p_company_id: companyId, p_id: baseId, p_code: base.code, p_name: base.code, p_rate: 1, p_is_base: true });
    bases = (await db.query(`SELECT count(*)::int c FROM currencies WHERE company_id=$1 AND is_base`, [companyId])).rows[0].c;
    check('base restored to the original currency', bases === 1, String(bases));

    /* --- FX sales invoice ---------------------------------------------------------- */
    const inv = (await callRpc(db, 'create_sales_invoice_atomic', {
      p_company_id: companyId, p_contact_id: client, p_project_id: null,
      p_date: date, p_due_date: date,
      p_items: JSON.stringify([{ description: 'خدمة دولارية', quantity: 1, unitPrice: 1000 }]),
      p_vat_rate: 0.15, p_vat_enabled: true, p_notes: null,
      p_collected_amount: 0, p_bank_safe_id: null, p_user_id: userId,
      p_currency_code: 'USD', p_exchange_rate: 3.75,
    })).rows[0].result;
    assertBalance(inv.total, 1150, 'invoice total in document currency (1000 + 15%)');
    const invRow = (await db.query(`SELECT currency_code, exchange_rate FROM invoices WHERE id=$1`, [inv.id])).rows[0];
    check('invoice row carries currency + rate', invRow.currency_code === 'USD' && Number(invRow.exchange_rate) === 3.75, JSON.stringify(invRow));
    const tagged = (await db.query(`
      SELECT count(*)::int c, count(currency_id)::int tagged
      FROM journal_lines WHERE journal_entry_id=$1`, [inv.journal_entry_id])).rows[0];
    check('all JE lines tagged with the currency', tagged.c === tagged.tagged && tagged.c === 3, JSON.stringify(tagged));
    await rejects(callRpc(db, 'create_sales_invoice_atomic', {
      p_company_id: companyId, p_contact_id: client, p_project_id: null,
      p_date: date, p_due_date: date,
      p_items: JSON.stringify([{ description: 'x', quantity: 1, unitPrice: 100 }]),
      p_vat_rate: 0, p_vat_enabled: false, p_notes: null,
      p_collected_amount: 0, p_bank_safe_id: null, p_user_id: userId,
      p_currency_code: 'JPY', p_exchange_rate: 1,
    }), 'unknown currency is rejected', 'العملة المحددة غير موجودة');
    await rejects(callRpc(db, 'create_sales_invoice_atomic', {
      p_company_id: companyId, p_contact_id: client, p_project_id: null,
      p_date: date, p_due_date: date,
      p_items: JSON.stringify([{ description: 'x', quantity: 1, unitPrice: 100 }]),
      p_vat_rate: 0, p_vat_enabled: false, p_notes: null,
      p_collected_amount: 0, p_bank_safe_id: null, p_user_id: userId,
      p_currency_code: 'USD', p_exchange_rate: 0,
    }), 'non-positive exchange rate is rejected', 'سعر الصرف غير صالح');

    /* --- realized FX GAIN on settlement (rate up) -------------------------------------- */
    const receipt = (await callRpc(db, 'create_voucher_receipt_atomic', {
      p_company_id: companyId, p_date: date, p_receipt_type: 'client',
      p_contact_id: client, p_amount: 1150, p_bank_safe_id: A.banks,
      p_reason: 'تحصيل فواتير دولارية',
      p_allocations: JSON.stringify([{ invoice_id: inv.id, amount: 1150 }]),
      p_auto_fifo: false, p_request_approval: false, p_user_id: userId,
      p_currency_code: 'USD', p_exchange_rate: 4,
    })).rows[0].result;
    // fx = 1150 × (4 − 3.75) / 4 = 71.875 → 71.88; relief = 1078.12
    const rje = (await db.query(`
      SELECT a.code, COALESCE(SUM(jl.debit - jl.credit),0) net
      FROM journal_lines jl JOIN journal_entries je ON je.id=jl.journal_entry_id
      JOIN accounts a ON a.id=jl.account_id
      WHERE je.id=$1 GROUP BY a.code ORDER BY a.code`, [receipt.journal_entry_id])).rows;
    const rnet = Object.fromEntries(rje.map((r) => [r.code, Number(r.net)]));
    check('gain receipt JE balanced', Math.abs(Object.values(rnet).reduce((s, v) => s + v, 0)) < 0.005, JSON.stringify(rnet));
    assertBalance(rnet['1121'], 1150, 'Dr bank 1150 (amount in document currency)');
    assertBalance(rnet['1130'], -1078.12, 'AR relief = alloc − fx (keeps AR at the recording rate)');
    assertBalance(rnet['4210'], -71.88, 'realized FX GAIN 71.88 credited to 4210');
    check('invoice marked paid', (await db.query(`SELECT status FROM invoices WHERE id=$1`, [inv.id])).rows[0].status === 'paid', '');
    // AR from the invoice (Dr 1150) minus relief (Cr 1078.12) = 71.88 residual
    const arNet = (await db.query(`
      SELECT COALESCE(SUM(jl.debit - jl.credit),0) net
      FROM journal_lines jl JOIN journal_entries je ON je.id=jl.journal_entry_id
      JOIN accounts a ON a.id=jl.account_id
      WHERE je.company_id=$1 AND a.code='1130'`, [companyId])).rows[0].net;
    assertBalance(Number(arNet), 71.88, 'PRODUCT NOTE: AR carries a 71.88 ghost residual after the FX settlement (gain parked in 4210)');

    /* --- realized FX LOSS on settlement (rate down) -------------------------------------- */
    const inv2 = (await callRpc(db, 'create_sales_invoice_atomic', {
      p_company_id: companyId, p_contact_id: client, p_project_id: null,
      p_date: date, p_due_date: date,
      p_items: JSON.stringify([{ description: 'دولارية بلا ضريبة', quantity: 1, unitPrice: 1000 }]),
      p_vat_rate: 0, p_vat_enabled: false, p_notes: null,
      p_collected_amount: 0, p_bank_safe_id: null, p_user_id: userId,
      p_currency_code: 'USD', p_exchange_rate: 3.75,
    })).rows[0].result;
    const receipt2 = (await callRpc(db, 'create_voucher_receipt_atomic', {
      p_company_id: companyId, p_date: date, p_receipt_type: 'client',
      p_contact_id: client, p_amount: 1000, p_bank_safe_id: A.banks,
      p_reason: 'تحصيل بخسارة عملة',
      p_allocations: JSON.stringify([{ invoice_id: inv2.id, amount: 1000 }]),
      p_auto_fifo: false, p_request_approval: false, p_user_id: userId,
      p_currency_code: 'USD', p_exchange_rate: 3,
    })).rows[0].result;
    // fx = 1000 × (3 − 3.75) / 3 = −250; relief = 1250
    const r2net = Object.fromEntries((await db.query(`
      SELECT a.code, COALESCE(SUM(jl.debit - jl.credit),0) net
      FROM journal_lines jl JOIN journal_entries je ON je.id=jl.journal_entry_id
      JOIN accounts a ON a.id=jl.account_id
      WHERE je.id=$1 GROUP BY a.code`, [receipt2.journal_entry_id])).rows.map((r) => [r.code, Number(r.net)]));
    check('loss receipt JE balanced', Math.abs(Object.values(r2net).reduce((s, v) => s + v, 0)) < 0.005, JSON.stringify(r2net));
    assertBalance(r2net['1130'], -1250, 'AR relief = alloc − (−250)');
    assertBalance(r2net['5450'], 250, 'realized FX LOSS 250 debited to 5450');

    /* --- base-currency settlement posts no FX lines ---------------------------------------- */
    const inv3 = (await callRpc(db, 'create_sales_invoice_atomic', {
      p_company_id: companyId, p_contact_id: client, p_project_id: null,
      p_date: date, p_due_date: date,
      p_items: JSON.stringify([{ description: 'محلية', quantity: 1, unitPrice: 500 }]),
      p_vat_rate: 0, p_vat_enabled: false, p_notes: null,
      p_collected_amount: 0, p_bank_safe_id: null, p_user_id: userId,
    })).rows[0].result;
    const receipt3 = (await callRpc(db, 'create_voucher_receipt_atomic', {
      p_company_id: companyId, p_date: date, p_receipt_type: 'client',
      p_contact_id: client, p_amount: 500, p_bank_safe_id: A.safe,
      p_reason: 'تحصيل محلي',
      p_allocations: JSON.stringify([{ invoice_id: inv3.id, amount: 500 }]),
      p_auto_fifo: false, p_request_approval: false, p_user_id: userId,
    })).rows[0].result;
    const r3codes = (await db.query(`
      SELECT DISTINCT a.code FROM journal_lines jl JOIN journal_entries je ON je.id=jl.journal_entry_id
      JOIN accounts a ON a.id=jl.account_id WHERE je.id=$1`, [receipt3.journal_entry_id])).rows.map((r) => r.code);
    check('base settlement has no 4210/5450 lines', !r3codes.includes('4210') && !r3codes.includes('5450'), JSON.stringify(r3codes));

    /* --- FX through the approval path --------------------------------------------------------- */
    const inv4 = (await callRpc(db, 'create_sales_invoice_atomic', {
      p_company_id: companyId, p_contact_id: client, p_project_id: null,
      p_date: date, p_due_date: date,
      p_items: JSON.stringify([{ description: 'دولارية بالاعتماد', quantity: 1, unitPrice: 500 }]),
      p_vat_rate: 0, p_vat_enabled: false, p_notes: null,
      p_collected_amount: 0, p_bank_safe_id: null, p_user_id: userId,
      p_currency_code: 'USD', p_exchange_rate: 3.75,
    })).rows[0].result;
    const pend = (await callRpc(db, 'create_voucher_receipt_atomic', {
      p_company_id: companyId, p_date: date, p_receipt_type: 'client',
      p_contact_id: client, p_amount: 500, p_bank_safe_id: A.banks,
      p_reason: 'تحويل دولاري يتطلب اعتماد',
      p_allocations: JSON.stringify([{ invoice_id: inv4.id, amount: 500 }]),
      p_auto_fifo: false, p_request_approval: true, p_user_id: userId,
      p_currency_code: 'USD', p_exchange_rate: 4,
    })).rows[0].result;
    check('pending receipt: no journal yet', pend.status === 'pending' && pend.journal_entry_id === null && !!pend.approval_id,
      JSON.stringify({ s: pend.status, je: pend.journal_entry_id }));
    check('invoice untouched while pending', (await db.query(`SELECT status, paid_amount FROM invoices WHERE id=$1`, [inv4.id])).rows[0].status === 'unpaid', '');

    const rej = (await callRpc(db, 'respond_voucher_receipt_approval', {
      p_company_id: companyId, p_approval_id: pend.approval_id, p_action: 'reject',
      p_approver_user_id: userId, p_approver_chat_id: null, p_comments: 'تراجع',
    })).rows[0].result;
    check('rejection closes the request without a journal', rej.status === 'rejected', rej.status);
    const rejRow = (await db.query(`SELECT status, journal_entry_id FROM voucher_receipts WHERE id=$1`, [pend.voucher_id ?? pend.id])).rows[0];
    check('receipt row rejected, no JE', rejRow.status === 'rejected' && rejRow.journal_entry_id === null, JSON.stringify(rejRow));

    const pend2 = (await callRpc(db, 'create_voucher_receipt_atomic', {
      p_company_id: companyId, p_date: date, p_receipt_type: 'client',
      p_contact_id: client, p_amount: 500, p_bank_safe_id: A.banks,
      p_reason: 'تحويل دولاري يتطلب اعتماد 2',
      p_allocations: JSON.stringify([{ invoice_id: inv4.id, amount: 500 }]),
      p_auto_fifo: false, p_request_approval: true, p_user_id: userId,
      p_currency_code: 'USD', p_exchange_rate: 4,
    })).rows[0].result;
    const appr = (await callRpc(db, 'respond_voucher_receipt_approval', {
      p_company_id: companyId, p_approval_id: pend2.approval_id, p_action: 'approve',
      p_approver_user_id: userId, p_approver_chat_id: null, p_comments: null,
    })).rows[0].result;
    check('approval posts the journal', appr.status === 'approved' && !!appr.journal_entry_id, JSON.stringify({ s: appr.status }));
    // fx = 500 × (4 − 3.75) / 4 = 31.25; relief = 468.75
    const a2net = Object.fromEntries((await db.query(`
      SELECT a.code, COALESCE(SUM(jl.debit - jl.credit),0) net
      FROM journal_lines jl JOIN journal_entries je ON je.id=jl.journal_entry_id
      JOIN accounts a ON a.id=jl.account_id
      WHERE je.id=$1 GROUP BY a.code`, [appr.journal_entry_id])).rows.map((r) => [r.code, Number(r.net)]));
    check('approved FX JE balanced', Math.abs(Object.values(a2net).reduce((s, v) => s + v, 0)) < 0.005, JSON.stringify(a2net));
    assertBalance(a2net['4210'], -31.25, 'approval path: FX gain 31.25 to 4210');
    assertBalance(a2net['1130'], -468.75, 'approval path: AR relief 468.75');
    check('invoice paid after approval', (await db.query(`SELECT status FROM invoices WHERE id=$1`, [inv4.id])).rows[0].status === 'paid', '');

    /* --- invariants ------------------------------------------------------------------------------ */
    await invDoubleEntry(db, companyId);
    await invTrialBalance(db, companyId);
  }
}
