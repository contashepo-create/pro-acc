/**
 * Section 10 — Quotations (عروض الأسعار)
 *
 * Engine: 049 (create/update_draft/delete_draft), 050+058 (convert_quotation_atomic
 * with tenant guard). Quotation lifecycle: draft → sent → (accepted) → converted.
 *
 * PRODUCT GAP documented by this section: nothing in the codebase writes
 * quotations.status='accepted' — no RPC, no API route, no UI action; the only
 * status writers are update_draft_quotation (draft→sent) and convert itself
 * (→converted). convert_quotation_atomic requires 'accepted', so the
 * quotation→project+invoice conversion is unreachable through the product.
 * The audit therefore simulates acceptance with a direct UPDATE (DB-level
 * audit) and verifies the accounting semantics the conversion would post:
 *   project (contract_value = quote total) + BOQ items + invoice
 *   Dr 1130 total / Cr 4100 (net of discount) / Cr 2120 tax,
 *   reference_type 'quotation_conversion', quote marked converted,
 *   idempotent re-convert.
 */
import { callRpc, check, assertBalance, rejects, seedTenant, invDoubleEntry, invTrialBalance } from '../framework.mjs';

export const name = '10 Quotations (عروض الأسعار)';

export async function run({ db }) {
  {
    const A = await seedTenant(db, { name: 'مراجعة 10', email: 'audit10@example.test' });
    const { companyId, userId, contacts } = A;
    const client = contacts.client;
    const date = '2026-07-01';

    const q = (await callRpc(db, 'create_quotation', {
      p_company_id: companyId, p_date: date, p_contact_id: client,
      p_items: JSON.stringify([
        { description: 'بند عرض 1', quantity: 5, unit_price: 200 },
        { description: 'بند عرض 2', quantity: 2, unit_price: 150 },
      ]),
      p_notes: 'عرض المراجعة', p_tax_rate: 0.15, p_valid_until: '2026-08-01', p_created_by: userId,
    })).rows[0].result;
    assertBalance(q.subtotal, 1300, 'quote subtotal 5×200 + 2×150');
    assertBalance(q.tax_amount, 195, 'quote tax 1300×15%');
    assertBalance(q.total, 1495, 'quote total');
    check('quote starts as draft', q.status === 'draft', q.status);
    check('quote carries its items', Array.isArray(q.items) && q.items.length === 2, String(q.items?.length));

    /* --- creation guards ---------------------------------------------------- */
    await rejects(callRpc(db, 'create_quotation', {
      p_company_id: companyId, p_date: date, p_contact_id: client,
      p_items: JSON.stringify([{ description: 'x', quantity: 1, unit_price: 1 }]),
      p_notes: null, p_tax_rate: 0.15, p_valid_until: '2026-06-30', p_created_by: userId,
    }), 'valid_until before the quote date is rejected', 'غير صالحة');
    await rejects(callRpc(db, 'create_quotation', {
      p_company_id: companyId, p_date: date, p_contact_id: client,
      p_items: JSON.stringify([{ description: 'x', quantity: 1, unit_price: 1 }]),
      p_notes: null, p_tax_rate: 1.2, p_valid_until: null, p_created_by: userId,
    }), 'tax rate > 1 is rejected', 'غير صالحة');
    await rejects(callRpc(db, 'create_quotation', {
      p_company_id: companyId, p_date: date, p_contact_id: client,
      p_items: '[]', p_notes: null, p_tax_rate: 0.15, p_valid_until: null, p_created_by: userId,
    }), 'empty items are rejected', 'غير صالحة');
    await rejects(callRpc(db, 'create_quotation', {
      p_company_id: companyId, p_date: date, p_contact_id: client,
      p_items: JSON.stringify([{ description: 'x', quantity: 0, unit_price: 1 }]),
      p_notes: null, p_tax_rate: 0.15, p_valid_until: null, p_created_by: userId,
    }), 'zero-quantity line is rejected', 'غير صالح');

    /* --- draft updates -------------------------------------------------------- */
    const qUpd = (await callRpc(db, 'update_draft_quotation', {
      p_company_id: companyId, p_quotation_id: q.id,
      p_payload: JSON.stringify({ discount_amount: 95, notes: 'محدث' }),
      p_items: JSON.stringify([
        { description: 'بند عرض 1', quantity: 5, unit_price: 200 },
        { description: 'بند عرض 2', quantity: 2, unit_price: 150 },
      ]),
    })).rows[0].result;
    assertBalance(qUpd.discount_amount, 95, 'discount stored');
    assertBalance(qUpd.total, 1400, 'total = 1300 + 195 − 95');
    check('still draft after content update', qUpd.status === 'draft', qUpd.status);

    await rejects(callRpc(db, 'update_draft_quotation', {
      p_company_id: companyId, p_quotation_id: q.id,
      p_payload: JSON.stringify({ tax_rate: 0.14 }), p_items: null,
    }), 'tax-rate change without items is rejected (draft)', 'يتطلب البنود');
    await rejects(callRpc(db, 'update_draft_quotation', {
      p_company_id: companyId, p_quotation_id: q.id,
      p_payload: JSON.stringify({ status: 'accepted' }), p_items: null,
    }), 'draft→accepted is not a valid transition (only sent)', 'انتقال الحالة غير صالح');
    const qSent = (await callRpc(db, 'update_draft_quotation', {
      p_company_id: companyId, p_quotation_id: q.id,
      p_payload: JSON.stringify({ status: 'sent' }), p_items: null,
    })).rows[0].result;
    check('draft→sent allowed', qSent.status === 'sent', qSent.status);
    await rejects(callRpc(db, 'update_draft_quotation', {
      p_company_id: companyId, p_quotation_id: q.id,
      p_payload: JSON.stringify({ notes: 'x' }), p_items: null,
    }), 'a sent quote cannot be edited', 'غير مسودة');
    /* --- delete rules ---------------------------------------------------------- */
    const q2 = (await callRpc(db, 'create_quotation', {
      p_company_id: companyId, p_date: date, p_contact_id: client,
      p_items: JSON.stringify([{ description: 'عرض ثانٍ', quantity: 1, unit_price: 10 }]),
      p_notes: null, p_tax_rate: 0, p_valid_until: null, p_created_by: userId,
    })).rows[0].result;
    const del = (await callRpc(db, 'delete_draft_quotation', {
      p_company_id: companyId, p_quotation_id: q2.id,
    })).rows[0].result;
    check('draft quotation deletes', del === true, String(del));
    const gone = (await db.query(`SELECT count(*)::int c FROM quotations WHERE id=$1`, [q2.id])).rows[0].c;
    check('deleted row is gone', gone === 0, String(gone));
    await rejects(callRpc(db, 'delete_draft_quotation', {
      p_company_id: companyId, p_quotation_id: q.id,
    }), 'a sent quotation cannot be deleted', 'غير مسودة');

    /* --- conversion (acceptance simulated at DB level — see section header) ---- */
    await db.query(`UPDATE quotations SET status='accepted' WHERE id=$1`, [q.id]);
    await rejects(callRpc(db, 'convert_quotation_atomic', {
      p_company_id: companyId, p_quotation_id: q.id,
      p_project_name: null, p_start_date: '2026-07-05', p_end_date: null, p_user_id: userId,
    }), 'conversion without a project name is rejected', 'غير صالحة');

    const conv = (await callRpc(db, 'convert_quotation_atomic', {
      p_company_id: companyId, p_quotation_id: q.id,
      p_project_name: 'مشروع المراجعة 10', p_start_date: '2026-07-05',
      p_end_date: '2026-12-05', p_user_id: userId,
    })).rows[0].result;
    // convert returns the PROJECT (status 'active'), not the quote
    check('convert returns the project', conv.status === 'active' && !!conv.id, conv.status);
    const qAfter = (await db.query(`SELECT status, project_id FROM quotations WHERE id=$1`, [q.id])).rows[0];
    check('quote row marked converted with project link', qAfter.status === 'converted' && qAfter.project_id === conv.id,
      `${qAfter.status} → ${qAfter.project_id}`);

    const proj = (await db.query(`SELECT * FROM projects WHERE id=$1`, [conv.id])).rows[0];
    assertBalance(proj.contract_value, 1400, 'project contract value = quote total');
    check('project belongs to the quote client', proj.client_id === client, '');
    check('project description cites the quote number', String(proj.description).includes(String(q.number)), String(proj.description));
    const boq = (await db.query(`SELECT count(*)::int c, sum(total) s FROM boq_items WHERE project_id=$1`, [conv.id])).rows[0];
    check('BOQ rows mirror quote lines', boq.c === 2 && Number(boq.s) === 1300, JSON.stringify(boq));

    const inv = (await db.query(`SELECT * FROM invoices WHERE project_id=$1 ORDER BY number DESC LIMIT 1`, [conv.id])).rows[0];
    assertBalance(inv.subtotal, 1205, 'invoice net subtotal (1300 − 95 discount)');
    assertBalance(inv.vat_amount, 195, 'invoice tax carried from quote');
    assertBalance(inv.total, 1400, 'invoice total = quote total');
    check('invoice is unpaid and linked to the project', inv.status === 'unpaid' && inv.project_id === conv.id, `${inv.status} proj=${inv.project_id} vs ${conv.id}`);
    const invItems = (await db.query(`SELECT sum(total) s FROM invoice_items WHERE invoice_id=$1`, [inv.id])).rows[0];
    assertBalance(invItems.s, 1205, 'invoice line totals carry the distributed discount');

    const je = (await db.query(`
      SELECT je.reference_type,
        (SELECT sum(jl.debit) FROM journal_lines jl WHERE jl.journal_entry_id=je.id) d,
        (SELECT sum(jl.credit) FROM journal_lines jl WHERE jl.journal_entry_id=je.id) c
      FROM journal_entries je WHERE je.id=$1`, [inv.journal_entry_id])).rows[0];
    check('conversion JE reference type', je.reference_type === 'quotation_conversion', String(je.reference_type));
    assertBalance(je.d, 1400, 'conversion JE debit (1130) = total');
    assertBalance(je.c, 1400, 'conversion JE credit side balanced');
    const jeAccs = (await db.query(`
      SELECT a.code, COALESCE(SUM(jl.debit - jl.credit),0) net
      FROM journal_lines jl JOIN accounts a ON a.id=jl.account_id
      WHERE jl.journal_entry_id=$1 GROUP BY a.code ORDER BY a.code`, [inv.journal_entry_id])).rows;
    check('conversion JE = Dr 1130 / Cr 4100 (net) / Cr 2120 (tax)',
      jeAccs.length === 3
      && Number(jeAccs.find((r) => r.code === '1130').net) === 1400
      && Number(jeAccs.find((r) => r.code === '4100').net) === -1205
      && Number(jeAccs.find((r) => r.code === '2120').net) === -195,
      JSON.stringify(jeAccs));

    /* --- idempotency & state guards ------------------------------------------- */
    const projCount = (await db.query(`SELECT count(*)::int c FROM projects WHERE company_id=$1`, [companyId])).rows[0].c;
    const conv2 = (await callRpc(db, 'convert_quotation_atomic', {
      p_company_id: companyId, p_quotation_id: q.id,
      p_project_name: 'مشروع المراجعة 10', p_start_date: '2026-07-05',
      p_end_date: '2026-12-05', p_user_id: userId,
    })).rows[0].result;
    check('re-convert is idempotent (already_processed)', conv2.already_processed === true, JSON.stringify(conv2).slice(0, 80));
    const projCount2 = (await db.query(`SELECT count(*)::int c FROM projects WHERE company_id=$1`, [companyId])).rows[0].c;
    check('re-convert creates no second project', projCount === projCount2, `${projCount} → ${projCount2}`);

    const q3 = (await callRpc(db, 'create_quotation', {
      p_company_id: companyId, p_date: date, p_contact_id: client,
      p_items: JSON.stringify([{ description: 'عرض غير مقبول', quantity: 1, unit_price: 10 }]),
      p_notes: null, p_tax_rate: 0, p_valid_until: null, p_created_by: userId,
    })).rows[0].result;
    await rejects(callRpc(db, 'convert_quotation_atomic', {
      p_company_id: companyId, p_quotation_id: q3.id,
      p_project_name: 'مشروع بلا قبول', p_start_date: '2026-07-05', p_end_date: null, p_user_id: userId,
    }), 'converting a non-accepted quote is rejected', 'قبل تحويله');

    /* --- invariants -------------------------------------------------------------- */
    await invDoubleEntry(db, companyId);
    await invTrialBalance(db, companyId);
  }
}
