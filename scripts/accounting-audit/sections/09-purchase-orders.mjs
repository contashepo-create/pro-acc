/**
 * Section 09 — Purchase Orders (أوامر الشراء)
 *
 * Engine: 055 (create/update/receive/cancel — final), 108 (PO-linked PI guards
 * + 2145 GRNI debit). Accounting semantics under audit:
 *   - PO itself is document-only: NO journal entry at creation/update/cancel.
 *   - Receipt: Dr 1170 (inventory) / Cr 2145 (GRNI — goods received not yet
 *     invoiced), weighted-average inventory cost, inventory_transactions row
 *     per line, status partial/received, idempotent re-receive.
 *   - PI against a PO (108): Dr 2145 / Cr 2110 — the GRNI is cleared, so a
 *     completed receive→invoice cycle must leave 2145 at exactly zero.
 *   - Guards: PO must be fully received + same supplier + exact total match +
 *     one live PI per PO + PI date ≥ last receipt date; cancel only when
 *     nothing was received; update only while pending.
 */
import { callRpc, check, assertBalance, rejects, seedTenant, invDoubleEntry, invTrialBalance, invPurchaseInvoiceMath } from '../framework.mjs';

export const name = '09 Purchase Orders (أوامر الشراء)';

export async function run({ db }) {
  {
    const A = await seedTenant(db, { name: 'مراجعة 09', email: 'audit09@example.test' });
    const { companyId, userId } = A;
    const { contacts } = A;
    const supplier = contacts.supplier;
    const warehouse = A.warehouse;
    const date = '2026-06-21';

    const poItems = (lines) => JSON.stringify(lines);
    const L = (description, quantity, unit_price) => ({ description, quantity, unit_price });

    /* --- 1. creation: document-only, correct total & numbering ------------- */
    const po = (await callRpc(db, 'create_purchase_order_atomic', {
      p_company_id: companyId, p_supplier_id: supplier, p_date: date,
      p_items: poItems([L('مراجعة-أ9', 10, 100), L('مراجعة-ب9', 4, 50)]),
      p_notes: 'أمر شراء المراجعة', p_user_id: userId,
    })).rows[0].result;
    check('PO created pending', po.status === 'pending', po.status);
    assertBalance(po.total, 1200, 'PO total = 10×100 + 4×50');
    check('PO number matches po_number text', String(po.number) === String(po.po_number), `${po.number}/${po.po_number}`);
    const jeCount1 = (await db.query(`SELECT count(*)::int c FROM journal_entries WHERE company_id=$1`, [companyId])).rows[0].c;
    check('no journal entry for a PO (document only)', jeCount1 === 2, `je count ${jeCount1} (2 opening funding entries only)`);

    /* --- 2. update while pending: items rewritten, total recomputed -------- */
    const poUpd = (await callRpc(db, 'update_purchase_order_atomic', {
      p_company_id: companyId, p_order_id: po.id, p_supplier_id: supplier, p_date: date,
      p_items: poItems([L('مراجعة-أ9', 10, 100), L('مراجعة-ب9', 8, 50)]),
      p_notes: null, p_user_id: userId,
    })).rows[0].result;
    assertBalance(poUpd.total, 1400, 'updated total = 1000 + 8×50');
    const poLines = (await db.query(`SELECT * FROM purchase_order_items WHERE purchase_order_id=$1 AND company_id=$2 ORDER BY lower(description)`, [po.id, companyId])).rows;
    const lineA = poLines.find((r) => r.description === 'مراجعة-أ9');
    const lineB = poLines.find((r) => r.description === 'مراجعة-ب9');
    check('items replaced on update', poLines.length === 2 && Number(lineA.quantity) === 10 && Number(lineB.quantity) === 8,
      JSON.stringify(poLines.map((r) => [r.description, r.quantity])));
    const received0 = (await db.query(`SELECT sum(received_quantity) s FROM purchase_order_items WHERE purchase_order_id=$1`, [po.id])).rows[0].s;
    check('received_quantity reset on update', Number(received0) === 0, String(received0));

    /* --- 3. partial receipt: one line half --------------------------------- */
    const half = (await callRpc(db, 'receive_purchase_order_atomic', {
      p_company_id: companyId, p_order_id: po.id,
      p_quantities: JSON.stringify({ [lineA.id]: 5 }),
      p_received_date: date, p_user_id: userId,
    })).rows[0].result;
    check('partial receipt → status partial', half.status === 'partial', half.status);
    check('receipt returns journal id', !!half.journal_entry_id, String(half.journal_entry_id));
    const stockA = (await db.query(`SELECT * FROM inventory_items WHERE company_id=$1 AND lower(code)=lower('مراجعة-أ9')`, [companyId])).rows[0];
    assertBalance(stockA.quantity, 5, 'inventory qty after partial (5 of 10)');
    assertBalance(stockA.unit_price, 100, 'inventory cost = PO line price');
    const txA = (await db.query(`SELECT count(*)::int c, sum(quantity) q FROM inventory_transactions WHERE company_id=$1 AND reference_type='purchase_order' AND reference_id=$2`, [companyId, po.id])).rows[0];
    check('inventory transaction row for receipt', txA.c === 1 && Number(txA.q) === 5, JSON.stringify(txA));
    const je1 = (await db.query(`SELECT je.*, (SELECT sum(jl.debit) FROM journal_lines jl WHERE jl.journal_entry_id=je.id) d,
      (SELECT sum(jl.credit) FROM journal_lines jl WHERE jl.journal_entry_id=je.id) c
      FROM journal_entries je WHERE je.id=$1`, [half.journal_entry_id])).rows[0];
    assertBalance(je1.d, 500, 'receipt JE debit (1170) = 5×100');
    assertBalance(je1.c, 500, 'receipt JE credit (2145 GRNI) = 500');
    check('receipt JE reference type', je1.reference_type === 'purchase_order_receipt', String(je1.reference_type));
    const recvLines = (await db.query(`
      SELECT a.code FROM journal_lines jl JOIN accounts a ON a.id=jl.account_id WHERE jl.journal_entry_id=$1`, [half.journal_entry_id])).rows;
    check('receipt JE touches exactly 1170 & 2145',
      recvLines.length === 2 && recvLines.map((r) => r.code).sort().join(',') === '1170,2145',
      recvLines.map((r) => r.code).join(','));

    /* --- 4. remaining receipt (NULL quantities = all remaining) ------------ */
    const full = (await callRpc(db, 'receive_purchase_order_atomic', {
      p_company_id: companyId, p_order_id: po.id, p_quantities: null,
      p_received_date: date, p_user_id: userId,
    })).rows[0].result;
    check('full receipt → status received', full.status === 'received', full.status);
    const invBal = await db.query(`
      SELECT a.code, COALESCE(SUM(jl.debit - jl.credit),0) net
      FROM journal_lines jl JOIN journal_entries je ON je.id=jl.journal_entry_id
      JOIN accounts a ON a.id=jl.account_id
      WHERE je.company_id=$1 AND a.code IN ('1170','2145') GROUP BY a.code`, [companyId]);
    const net = Object.fromEntries(invBal.rows.map((r) => [r.code, Number(r.net)]));
    assertBalance(net['1170'], 1400, 'inventory account = full PO value (500+900)');
    assertBalance(net['2145'], -1400, 'GRNI credit side = full PO value');
    const stockB = (await db.query(`SELECT * FROM inventory_items WHERE company_id=$1 AND lower(code)=lower('مراجعة-ب9')`, [companyId])).rows[0];
    assertBalance(stockB.quantity, 8, 'line 2 received fully');

    /* --- 5. re-receive after completion is idempotent ---------------------- */
    const again = (await callRpc(db, 'receive_purchase_order_atomic', {
      p_company_id: companyId, p_order_id: po.id, p_quantities: null,
      p_received_date: date, p_user_id: userId,
    })).rows[0].result;
    check('re-receive after received is idempotent', again.already_processed === true && again.status === 'received', JSON.stringify(again).slice(0, 100));
    const jeCount2 = (await db.query(`SELECT count(*)::int c FROM journal_entries WHERE company_id=$1 AND reference_type='purchase_order_receipt'`, [companyId])).rows[0].c;
    check('idempotent re-receive posts no new JE', jeCount2 === 2, `receipt JEs ${jeCount2}`);

    /* --- 6. PI against the PO clears GRNI (Dr 2145 / Cr 2110) -------------- */
    const pi = (await callRpc(db, 'create_purchase_invoice_atomic', {
      p_company_id: companyId, p_supplier_id: supplier, p_purchase_order_id: po.id,
      p_project_id: null, p_custody_id: null, p_link_to_project: false,
      p_date: '2026-06-22',
      p_items: poItems([L('مراجعة-أ9', 10, 100), L('مراجعة-ب9', 8, 50)]),
      p_tax_rate: 0, p_notes: null, p_user_id: userId,
      p_other_expenses: '[]', p_payment_account_id: null,
      p_withholding_rate: 0, p_paid_amount: 0, p_bank_safe_id: null,
    })).rows[0].result;
    const net2 = Object.fromEntries((await db.query(`
      SELECT a.code, COALESCE(SUM(jl.debit - jl.credit),0) net
      FROM journal_lines jl JOIN journal_entries je ON je.id=jl.journal_entry_id
      JOIN accounts a ON a.id=jl.account_id
      WHERE je.company_id=$1 AND a.code IN ('1170','2145','2110') GROUP BY a.code`, [companyId])).rows.map((r) => [r.code, Number(r.net)]));
    assertBalance(net2['1170'], 1400, 'inventory unchanged by the PI');
    assertBalance(net2['2145'], 0, 'GRNI fully cleared by the PI (Dr 2145 = Cr 2145)');
    assertBalance(net2['2110'], -1400, 'AP (2110) credited the full PO value');
    await invPurchaseInvoiceMath(db, companyId, pi.id);

    /* --- 7. PO-linked PI guards ------------------------------------------- */
    await rejects(callRpc(db, 'create_purchase_invoice_atomic', {
        p_company_id: companyId, p_supplier_id: supplier, p_purchase_order_id: po.id,
        p_project_id: null, p_custody_id: null, p_link_to_project: false,
        p_date: '2026-06-23',
        p_items: poItems([L('مراجعة-أ9', 10, 100), L('مراجعة-ب9', 8, 50)]),
        p_tax_rate: 0, p_notes: null, p_user_id: userId,
        p_other_expenses: '[]', p_payment_account_id: null,
        p_withholding_rate: 0, p_paid_amount: 0, p_bank_safe_id: null,
      }), 'second PI for the same PO is rejected', 'تمت فوترة');
    const po2 = (await callRpc(db, 'create_purchase_order_atomic', {
      p_company_id: companyId, p_supplier_id: supplier, p_date: date,
      p_items: poItems([L('مراجعة-د9', 2, 250)]), p_notes: null, p_user_id: userId,
    })).rows[0].result;
    await rejects(callRpc(db, 'create_purchase_invoice_atomic', {
        p_company_id: companyId, p_supplier_id: supplier, p_purchase_order_id: po2.id,
        p_project_id: null, p_custody_id: null, p_link_to_project: false,
        p_date: date, p_items: poItems([L('مراجعة-د9', 2, 250)]),
        p_tax_rate: 0, p_notes: null, p_user_id: userId,
        p_other_expenses: '[]', p_payment_account_id: null,
        p_withholding_rate: 0, p_paid_amount: 0, p_bank_safe_id: null,
      }), 'PI against an un-received PO is rejected', 'مستلماً بالكامل');

    /* --- 8. receipt rejections -------------------------------------------- */
    const po3 = (await callRpc(db, 'create_purchase_order_atomic', {
      p_company_id: companyId, p_supplier_id: supplier, p_date: date,
      p_items: poItems([L('مراجعة-ه9', 3, 10)]), p_notes: null, p_user_id: userId,
    })).rows[0].result;
    const po3Line = (await db.query(`SELECT id FROM purchase_order_items WHERE purchase_order_id=$1`, [po3.id])).rows[0];
    await rejects(callRpc(db, 'receive_purchase_order_atomic', {
        p_company_id: companyId, p_order_id: po3.id,
        p_quantities: JSON.stringify({ [po3Line.id]: 4 }),
        p_received_date: date, p_user_id: userId,
      }), 'over-receipt beyond remaining is rejected', 'تتجاوز المتبقي');
    await rejects(callRpc(db, 'receive_purchase_order_atomic', {
        p_company_id: companyId, p_order_id: po3.id,
        p_quantities: JSON.stringify({ '99999999-9999-9999-9999-999999999999': 1 }),
        p_received_date: date, p_user_id: userId,
      }), 'unknown line id in quantities is rejected', 'بند أمر شراء غير معروف');
    await rejects(callRpc(db, 'receive_purchase_order_atomic', {
        p_company_id: companyId, p_order_id: po3.id, p_quantities: null,
        p_received_date: '2026-06-20', p_user_id: userId,
      }), 'receipt before the PO date is rejected', 'يسبق أمر الشراء');

    /* --- 9. weighted-average cost: pre-existing stock at another price ----- */
    await db.query(`INSERT INTO inventory_items(company_id, code, name, unit, warehouse_id, quantity, unit_price, is_active)
      VALUES($1, 'مراجعة-ج9', 'مراجعة-ج9', 'وحدة', $2, 10, 80, TRUE)`, [companyId, warehouse]);
    const po4 = (await callRpc(db, 'create_purchase_order_atomic', {
      p_company_id: companyId, p_supplier_id: supplier, p_date: date,
      p_items: poItems([L('مراجعة-ج9', 5, 120)]), p_notes: null, p_user_id: userId,
    })).rows[0].result;
    await callRpc(db, 'receive_purchase_order_atomic', {
      p_company_id: companyId, p_order_id: po4.id, p_quantities: null,
      p_received_date: date, p_user_id: userId,
    });
    const stockJ = (await db.query(`SELECT * FROM inventory_items WHERE company_id=$1 AND lower(code)=lower('مراجعة-ج9')`, [companyId])).rows[0];
    assertBalance(stockJ.quantity, 15, 'combined quantity 10+5');
    // (10×80 + 5×120) / 15 = 1400/15 = 93.333… → 93.33
    assertBalance(stockJ.unit_price, 93.33, 'weighted-average unit price');

    /* --- 10. cancellation rules -------------------------------------------- */
    const po5 = (await callRpc(db, 'create_purchase_order_atomic', {
      p_company_id: companyId, p_supplier_id: supplier, p_date: date,
      p_items: poItems([L('مراجعة-و9', 1, 5)]), p_notes: null, p_user_id: userId,
    })).rows[0].result;
    const po5Line = (await db.query(`SELECT id FROM purchase_order_items WHERE purchase_order_id=$1`, [po5.id])).rows[0];
    await callRpc(db, 'receive_purchase_order_atomic', {
      p_company_id: companyId, p_order_id: po5.id,
      p_quantities: JSON.stringify({ [po5Line.id]: 1 }),
      p_received_date: date, p_user_id: userId,
    });
    await rejects(callRpc(db, 'cancel_purchase_order_atomic', {
        p_company_id: companyId, p_order_id: po5.id, p_user_id: userId,
      }), 'cancelling a partially-received PO is rejected', 'لا يمكن إلغاء');
    await rejects(callRpc(db, 'cancel_purchase_order_atomic', {
        p_company_id: companyId, p_order_id: po.id, p_user_id: userId,
      }), 'cancelling a fully-received PO is rejected', 'لا يمكن إلغاء');
    const po6 = (await callRpc(db, 'create_purchase_order_atomic', {
      p_company_id: companyId, p_supplier_id: supplier, p_date: date,
      p_items: poItems([L('مراجعة-ز9', 1, 5)]), p_notes: null, p_user_id: userId,
    })).rows[0].result;
    const jeBeforeCancel = (await db.query(`SELECT count(*)::int c FROM journal_entries WHERE company_id=$1`, [companyId])).rows[0].c;
    const po6c = (await callRpc(db, 'cancel_purchase_order_atomic', {
      p_company_id: companyId, p_order_id: po6.id, p_user_id: userId,
    })).rows[0].result;
    check('pending PO cancels cleanly', po6c.status === 'cancelled', po6c.status);
    const jeAfterCancel = (await db.query(`SELECT count(*)::int c FROM journal_entries WHERE company_id=$1`, [companyId])).rows[0].c;
    check('cancellation posts no journal entry', jeBeforeCancel === jeAfterCancel, `${jeBeforeCancel} → ${jeAfterCancel}`);
    const po6c2 = (await callRpc(db, 'cancel_purchase_order_atomic', {
      p_company_id: companyId, p_order_id: po6.id, p_user_id: userId,
    })).rows[0].result;
    check('re-cancel is idempotent', po6c2.already_processed === true, JSON.stringify(po6c2).slice(0, 80));

    /* --- 11. creation guards ------------------------------------------------- */
    await rejects(callRpc(db, 'create_purchase_order_atomic', {
        p_company_id: companyId, p_supplier_id: contacts.client, p_date: date,
        p_items: poItems([L('مراجعة-ح9', 1, 5)]), p_notes: null, p_user_id: userId,
      }), 'non-supplier contact rejected', 'المورد غير موجود');
    await rejects(callRpc(db, 'create_purchase_order_atomic', {
        p_company_id: companyId, p_supplier_id: supplier, p_date: date,
        p_items: poItems([L('مراجعة-ح9', 1, 5)]), p_notes: 'x'.repeat(2001), p_user_id: userId,
      }), 'notes over 2000 chars rejected', 'بيانات أمر الشراء غير صالحة');

    /* --- 12. invariants ------------------------------------------------------ */
    await invDoubleEntry(db, companyId);
    await invTrialBalance(db, companyId);
  }
}
