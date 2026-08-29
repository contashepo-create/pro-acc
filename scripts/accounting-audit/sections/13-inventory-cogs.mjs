/**
 * Section 13 — Inventory, Stock Movements & COGS (المخزون وتكلفة البضاعة)
 *
 * Engine: 055 (items/warehouses + original movement), 071 (live movement with
 * project allocation + balance tracking), 094 (COGS on sales invoice +
 * cancellation restore), 109 (purchase wrapper — direct PI does NOT stock-in;
 * stock-in comes from PO receipt, section 09, or manual 'add').
 * Accounting semantics under audit:
 *   - 'add'    → Dr 1170 / Cr 4200, weighted-average (AVCO) unit price.
 *   - 'issue'  → Dr 5100 / Cr 1170 at current unit price.
 *   - 'adjust' → to p_quantity; Δ>0 like add (Cr 4200), Δ<0 like issue (Dr 5100);
 *     no-diff rejected.
 *   - 'return' → Dr 1170 / Cr 5100.
 *   - 'transfer' → no JE; target warehouse gets the same code (auto-created),
 *     AVCO-merged; source debits quantity.
 *   - Sales invoice with inventory items (094): stock decreases, 'issue'
 *     transactions referenced to the invoice, ONE COGS JE Dr 5100 total /
 *     Cr 1170 per item, reference_type 'invoice_cogs'. Cancellation reverses
 *     the COGS JE and restores quantity at the ORIGINAL issue cost.
 *   - Project allocation allowed only for issue/return, project must be active.
 */
import { callRpc, check, assertBalance, rejects, seedTenant, invDoubleEntry, invTrialBalance } from '../framework.mjs';

export const name = '13 Inventory & COGS (المخزون)';

const mov = (db, A, args) => callRpc(db, 'post_inventory_movement_atomic', {
  p_company_id: A.companyId, p_notes: null, p_to_warehouse_id: null,
  p_user_id: A.userId, p_project_id: null, ...args,
});

export async function run({ db }) {
  {
    const A = await seedTenant(db, { name: 'مراجعة 13', email: 'audit13@example.test' });
    const { companyId, userId } = A;
    const w1 = A.warehouse;
    const date = '2026-07-10';

    /* --- warehouse + item ------------------------------------------------------- */
    const w2 = (await callRpc(db, 'create_warehouse_atomic', {
      p_company_id: companyId, p_name: 'مستودع ثانٍ', p_location: 'الرياض', p_user_id: userId,
    })).rows[0].result.id;
    const item = (await callRpc(db, 'create_inventory_item_atomic', {
      p_company_id: companyId, p_code: 'INV-1', p_name: 'صنف المراجعة',
      p_unit: 'قطعة', p_warehouse_id: w1, p_category: 'مواد', p_user_id: userId,
    })).rows[0].result;
    check('item created with zero quantity', Number(item.quantity) === 0, String(item.quantity));

    const qty = async (id) => Number((await db.query(
      'SELECT quantity FROM inventory_items WHERE id=$1', [id])).rows[0].quantity);
    const cost = async (id) => Number((await db.query(
      'SELECT unit_price FROM inventory_items WHERE id=$1', [id])).rows[0].unit_price);

    /* --- add → AVCO + Dr 1170 / Cr 4200 ----------------------------------------- */
    await mov(db, A, { p_item_id: item.id, p_warehouse_id: w1, p_type: 'add', p_quantity: 10, p_unit_price: 100, p_date: date });
    assertBalance(await qty(item.id), 10, 'qty after first add');
    assertBalance(await cost(item.id), 100, 'unit price after first add');
    const add2 = (await mov(db, A, { p_item_id: item.id, p_warehouse_id: w1, p_type: 'add', p_quantity: 10, p_unit_price: 200, p_date: date })).rows[0].result;
    assertBalance(await qty(item.id), 20, 'qty after second add');
    assertBalance(await cost(item.id), 150, 'AVCO unit price (10×100 + 10×200)/20');

    const moveJEs = (jeId) => db.query(`
      SELECT a.code, COALESCE(SUM(jl.debit - jl.credit),0) net
      FROM journal_lines jl JOIN journal_entries je ON je.id=jl.journal_entry_id
      JOIN accounts a ON a.id=jl.account_id
      WHERE je.id=$1
      GROUP BY a.code`, [jeId]);
    const je13net = Object.fromEntries((await moveJEs(add2.journal_entry_id)).rows.map((r) => [r.code, Number(r.net)]));
    assertBalance(je13net['1170'], 2000, 'second add JE Dr 1170 2000');
    assertBalance(je13net['4200'], -2000, 'second add JE Cr 4200 (other income)');

    /* --- issue → Dr 5100 / Cr 1170 ------------------------------------------------ */
    const iss = (await mov(db, A, { p_item_id: item.id, p_warehouse_id: w1, p_type: 'issue', p_quantity: 5, p_unit_price: null, p_date: date })).rows[0].result;
    assertBalance(await qty(item.id), 15, 'qty after issue');
    const je14 = Object.fromEntries((await moveJEs(iss.journal_entry_id)).rows.map((r) => [r.code, Number(r.net)]));
    assertBalance(je14['5100'], 750, 'issue JE Dr 5100 (5 × 150 AVCO)');
    assertBalance(je14['1170'], -750, 'issue JE Cr 1170');
    await rejects(mov(db, A, { p_item_id: item.id, p_warehouse_id: w1, p_type: 'issue', p_quantity: 999, p_unit_price: null, p_date: date }),
      'issuing more than stock is rejected', 'غير متوفرة');

    /* --- adjustment ---------------------------------------------------------------- */
    const adj = (await mov(db, A, { p_item_id: item.id, p_warehouse_id: w1, p_type: 'adjust', p_quantity: 20, p_unit_price: null, p_date: date })).rows[0].result;
    assertBalance(await qty(item.id), 20, 'qty after adjust-up to 20');
    const je15 = Object.fromEntries((await moveJEs(adj.journal_entry_id)).rows.map((r) => [r.code, Number(r.net)]));
    assertBalance(je15['1170'], 750, 'adjust-up JE Dr 1170 (Δ5 × 150)');
    assertBalance(je15['4200'], -750, 'adjust-up JE Cr 4200');
    await rejects(mov(db, A, { p_item_id: item.id, p_warehouse_id: w1, p_type: 'adjust', p_quantity: 20, p_unit_price: null, p_date: date }),
      'no-diff adjustment is rejected', 'لا فرق');

    /* --- project allocation guards --------------------------------------------------- */
    await rejects(mov(db, A, { p_item_id: item.id, p_warehouse_id: w1, p_type: 'add', p_quantity: 1, p_unit_price: 1, p_date: date, p_project_id: '00000000-0000-0000-0000-000000000000' }),
      'project allocation on stock-in is rejected', 'مسموح فقط');
    const proj = (await callRpc(db, 'create_project_atomic', {
      p_company_id: companyId, p_name: 'مشروع المخزون', p_client_id: A.contacts.client,
      p_contract_value: 1000, p_start_date: date, p_end_date: '2026-12-31',
      p_status: 'active', p_description: null, p_location: null,
      p_items: JSON.stringify([{ description: 'م', quantity: 1, unit_price: 1000 }]),
      p_auto_invoice: false, p_user_id: userId,
    })).rows[0].result;
    const issP = (await mov(db, A, { p_item_id: item.id, p_warehouse_id: w1, p_type: 'issue', p_quantity: 1, p_unit_price: null, p_date: date, p_project_id: proj.id })).rows[0].result;
    check('issue can be allocated to an active project', issP.transaction.project_id === proj.id, String(issP.transaction.project_id));

    /* --- transfer: no JE, target auto-created, AVCO merge ------------------------------ */
    const trf = (await mov(db, A, { p_item_id: item.id, p_warehouse_id: w1, p_type: 'transfer', p_quantity: 5, p_unit_price: null, p_date: date, p_to_warehouse_id: w2 })).rows[0].result;
    assertBalance(await qty(item.id), 14, 'source qty after transfer (20 − 1 issue − 5 transferred)');
    const t2 = (await db.query(`SELECT * FROM inventory_items WHERE company_id=$1 AND warehouse_id=$2 AND code='INV-1'`, [companyId, w2])).rows[0];
    check('target item auto-created in destination warehouse', !!t2, '');
    assertBalance(t2.quantity, 5, 'target qty after transfer');
    check('transfer posts no journal entry', trf.journal_entry_id === null, String(trf.journal_entry_id));
    check('transfer transaction carries the destination warehouse', trf.transaction.to_warehouse_id === w2, String(trf.transaction.to_warehouse_id));

    /* --- return → Dr 1170 / Cr 5100 ------------------------------------------------------ */
    const ret = (await mov(db, A, { p_item_id: item.id, p_warehouse_id: w1, p_type: 'return', p_quantity: 3, p_unit_price: null, p_date: date })).rows[0].result;
    assertBalance(await qty(item.id), 17, 'qty after return (14+3)');
    const je16 = Object.fromEntries((await moveJEs(ret.journal_entry_id)).rows.map((r) => [r.code, Number(r.net)]));
    assertBalance(je16['1170'], 450, 'return JE Dr 1170 (3 × 150)');
    assertBalance(je16['5100'], -450, 'return JE Cr 5100');

    /* --- movement guards ------------------------------------------------------------------ */
    await rejects(mov(db, A, { p_item_id: item.id, p_warehouse_id: w1, p_type: 'wrong', p_quantity: 1, p_unit_price: null, p_date: date }),
      'unknown movement type is rejected', 'غير صالحة');
    await rejects(mov(db, A, { p_item_id: item.id, p_warehouse_id: w1, p_type: 'add', p_quantity: -1, p_unit_price: 5, p_date: date }),
      'negative quantity is rejected', 'غير صالحة');
    await rejects(mov(db, A, { p_item_id: t2.id, p_warehouse_id: w1, p_type: 'issue', p_quantity: 1, p_unit_price: null, p_date: date }),
      'movement from the wrong warehouse is rejected', 'لا ينتمي');
    await rejects(mov(db, A, { p_item_id: item.id, p_warehouse_id: w1, p_type: 'transfer', p_quantity: 1, p_unit_price: null, p_date: date, p_to_warehouse_id: w1 }),
      'transfer to the same warehouse is rejected', 'غير صالح');

    /* --- COGS on sales invoice (094) --------------------------------------------------------- */
    const sold = (await callRpc(db, 'create_inventory_item_atomic', {
      p_company_id: companyId, p_code: 'INV-2', p_name: 'صنف للبيع',
      p_unit: 'قطعة', p_warehouse_id: w1, p_category: 'سلع', p_user_id: userId,
    })).rows[0].result;
    await mov(db, A, { p_item_id: sold.id, p_warehouse_id: w1, p_type: 'add', p_quantity: 10, p_unit_price: 50, p_date: date });
    const plSnapshot = async () => Object.fromEntries((await db.query(`
      SELECT a.code, COALESCE(SUM(jl.debit - jl.credit),0) net
      FROM journal_lines jl JOIN journal_entries je ON je.id=jl.journal_entry_id
      JOIN accounts a ON a.id=jl.account_id
      WHERE je.company_id=$1 AND a.code IN ('5100','1170') GROUP BY a.code`, [companyId])).rows.map((r) => [r.code, Number(r.net)]));
    const preSale = await plSnapshot();
    const inv = (await callRpc(db, 'create_sales_invoice_atomic', {
      p_company_id: companyId, p_contact_id: A.contacts.client, p_project_id: null,
      p_date: date, p_due_date: date,
      p_items: JSON.stringify([{ description: 'بيع صنف', quantity: 4, unitPrice: 100, inventory_item_id: sold.id }]),
      p_vat_rate: 0.15, p_vat_enabled: true, p_notes: null,
      p_collected_amount: 0, p_bank_safe_id: null, p_user_id: userId,
    })).rows[0].result;
    assertBalance(await qty(sold.id), 6, 'stock decreased by the sold quantity');
    const cogsJE = (await db.query(`
      SELECT a.code, COALESCE(SUM(jl.debit - jl.credit),0) net
      FROM journal_lines jl JOIN journal_entries je ON je.id=jl.journal_entry_id
      JOIN accounts a ON a.id=jl.account_id
      WHERE je.reference_type='invoice_cogs' AND je.reference_id=$1 GROUP BY a.code`, [inv.id])).rows;
    const cogs = Object.fromEntries(cogsJE.map((r) => [r.code, Number(r.net)]));
    assertBalance(cogs['5100'], 200, 'COGS JE Dr 5100 (4 × cost 50)');
    assertBalance(cogs['1170'], -200, 'COGS JE Cr 1170');
    const issueTxn = (await db.query(`
      SELECT type, reference_type, reference_id FROM inventory_transactions
      WHERE company_id=$1 AND item_id=$2 AND reference_type='invoice'`, [companyId, sold.id])).rows[0];
    check('issue transaction referenced to the invoice', issueTxn.type === 'issue' && issueTxn.reference_id === inv.id, JSON.stringify(issueTxn));

    await rejects(callRpc(db, 'create_sales_invoice_atomic', {
      p_company_id: companyId, p_contact_id: A.contacts.client, p_project_id: null,
      p_date: date, p_due_date: date,
      p_items: JSON.stringify([{ description: 'بيع زائد', quantity: 100, unitPrice: 100, inventory_item_id: sold.id }]),
      p_vat_rate: 0.15, p_vat_enabled: true, p_notes: null,
      p_collected_amount: 0, p_bank_safe_id: null, p_user_id: userId,
    }), 'selling more than stock is rejected', 'غير متوفرة');

    /* --- cancellation restores stock at original cost ------------------------------------------ */
    const cancel = (await callRpc(db, 'cancel_sales_invoice_atomic', {
      p_company_id: companyId, p_invoice_id: inv.id, p_notes: 'إلغاء المراجعة', p_user_id: userId,
    })).rows[0].result;
    check('cancelled with a COGS reversal journal', cancel.status === 'cancelled' && !!cancel.cogs_reversal_journal_id,
      JSON.stringify({ s: cancel.status, c: cancel.cogs_reversal_journal_id }));
    assertBalance(await qty(sold.id), 10, 'stock fully restored after cancellation');
    const postCancel = await plSnapshot();
    assertBalance(postCancel['5100'], preSale['5100'], '5100 net fully restored to pre-sale (COGS + reversal net out)');
    assertBalance(postCancel['1170'], preSale['1170'], '1170 net fully restored to pre-sale');

    const retTxn = (await db.query(`
      SELECT type, unit_price FROM inventory_transactions
      WHERE company_id=$1 AND item_id=$2 AND reference_type='invoice_cancellation'`, [companyId, sold.id])).rows[0];
    check('return transaction at the ORIGINAL issue cost', retTxn.type === 'return' && Number(retTxn.unit_price) === 50, JSON.stringify(retTxn));

    /* --- invariants ----------------------------------------------------------------------------- */
    await invDoubleEntry(db, companyId);
    await invTrialBalance(db, companyId);
  }
}
