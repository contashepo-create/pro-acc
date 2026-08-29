/**
 * Section 16 — Tenders & Bonds (المناقصات وخطابات الضمان)
 *
 * Engine: 060 (tender/bond creation + tender state machine), 103 (tender
 * expenses, bond issue/release/cancel lifecycle, won-tender conversion with
 * accounting), 111 (tenders→contacts FK).
 * Accounting semantics under audit:
 *   - Tender lifecycle: draft → preparing → submitted → won|lost; cancelled
 *     from any pre-final state; same-status idempotent; 'won' requires
 *     estimated_value > 0. Updates/costs only while draft|preparing.
 *   - record_tender_expense_atomic: Dr 5410 tender-cost suspense (Dr 5291 for
 *     bid_bond_commission) / Dr 1180 VAT / Cr bank — with a per-tender cost
 *     center; 'bid_bond_margin' is rejected here (it moves at bond issue).
 *   - record_bond_issue_atomic: Dr 1185 (bid) or 1186 (other) cash margin /
 *     Dr 5291 commission / Dr 1180 VAT / Cr bank (margin ≤ amount); bond row
 *     'active' with margin/commission account links.
 *   - convert_won_tender_with_accounting_atomic: won only; creates the
 *     project, links the tender cost center + bonds to it, and transfers the
 *     pre-contract suspense (tender expenses EXCLUDING bond margin/commission)
 *     Dr 5195 (or 5110) / Cr 5410; idempotent via convert_journal_id.
 *   - release_bond_atomic: Dr bank / Cr 1185 margin returned; 'released'.
 */
import { callRpc, check, assertBalance, rejects, seedTenant, invDoubleEntry, invTrialBalance } from '../framework.mjs';

export const name = '16 Tenders & Bonds (المناقصات)';

export async function run({ db }) {
  {
    const A = await seedTenant(db, { name: 'مراجعة 16', email: 'audit16@example.test' });
    const { companyId, userId, byCode } = A;
    const today = new Date().toISOString().slice(0, 10);
    const d = (offsetDays) => new Date(Date.now() + offsetDays * 86400000).toISOString().slice(0, 10);

    /* --- tender creation + state machine ------------------------------------------- */
    const tender = (await callRpc(db, 'create_tender_atomic', {
      p_company_id: companyId, p_user_id: userId,
      p_payload: JSON.stringify({
        title: 'عطاء بناء برج', client_name: 'عميل العطاء',
        contact_id: A.contacts.client, estimated_value: 20000,
        bid_bond_amount: 2000, submission_deadline: d(30), opening_date: d(31),
        reference_number: 'TR-1', description: 'وصف العطاء',
        status: 'draft',
      }),
    })).rows[0].result;
    check('tender created as draft', tender.status === 'draft', tender.status);

    await rejects(callRpc(db, 'create_tender_atomic', {
      p_company_id: companyId, p_user_id: userId,
      p_payload: JSON.stringify({ title: 'مباشرة', client_name: 'عميل', estimated_value: 100, status: 'submitted' }),
    }), 'a tender cannot start already submitted', 'غير صالحة');

    await callRpc(db, 'transition_tender_atomic', { p_company_id: companyId, p_tender_id: tender.id, p_status: 'preparing', p_notes: null, p_user_id: userId });
    await rejects(callRpc(db, 'transition_tender_atomic', { p_company_id: companyId, p_tender_id: tender.id, p_status: 'won', p_notes: null, p_user_id: userId }),
      'preparing cannot jump straight to won', 'غير صالح');
    const same = (await callRpc(db, 'transition_tender_atomic', { p_company_id: companyId, p_tender_id: tender.id, p_status: 'preparing', p_notes: null, p_user_id: userId })).rows[0].result;
    check('same-status transition is idempotent', same.already_processed === true, JSON.stringify(same.already_processed));
    await callRpc(db, 'transition_tender_atomic', { p_company_id: companyId, p_tender_id: tender.id, p_status: 'submitted', p_notes: null, p_user_id: userId });
    await rejects(callRpc(db, 'update_tender_atomic', {
      p_company_id: companyId, p_tender_id: tender.id,
      p_patch: JSON.stringify({ title: 'تعديل بعد التقديم' }), p_user_id: userId,
    }), 'updating a submitted tender is rejected', 'بعد تقديمها');

    /* --- tender expenses (5410 suspense) ------------------------------------------------ */
    const exp1 = (await callRpc(db, 'record_tender_expense_atomic', {
      p_company_id: companyId, p_tender_id: tender.id, p_expense_type: 'karasa',
      p_amount: 1000, p_vat_amount: 150, p_bank_safe_id: A.banks,
      p_description: 'رسوم كراسة', p_date: today, p_user_id: userId,
    })).rows[0].result;
    const e1net = Object.fromEntries((await db.query(`
      SELECT a.code, COALESCE(SUM(jl.debit - jl.credit),0) net
      FROM journal_lines jl JOIN journal_entries je ON je.id=jl.journal_entry_id
      JOIN accounts a ON a.id=jl.account_id WHERE je.id=$1 GROUP BY a.code`, [exp1.journal_entry.id])).rows.map((r) => [r.code, Number(r.net)]));
    assertBalance(e1net['5410'], 1000, 'karasa fee Dr 5410 (pre-contract suspense)');
    assertBalance(e1net['1180'], 150, 'VAT Dr 1180');
    assertBalance(e1net['1121'], -1150, 'Cr bank 1150');

    const exp2 = (await callRpc(db, 'record_tender_expense_atomic', {
      p_company_id: companyId, p_tender_id: tender.id, p_expense_type: 'bid_bond_commission',
      p_amount: 100, p_vat_amount: 0, p_bank_safe_id: A.banks,
      p_description: 'عمولة ضمان سابقة', p_date: today, p_user_id: userId,
    })).rows[0].result;
    const e2net = Object.fromEntries((await db.query(`
      SELECT a.code, COALESCE(SUM(jl.debit - jl.credit),0) net
      FROM journal_lines jl JOIN journal_entries je ON je.id=jl.journal_entry_id
      JOIN accounts a ON a.id=jl.account_id WHERE je.id=$1 GROUP BY a.code`, [exp2.journal_entry.id])).rows.map((r) => [r.code, Number(r.net)]));
    assertBalance(e2net['5291'], 100, 'bond commission goes to 5291, not the 5410 suspense');

    await rejects(callRpc(db, 'record_tender_expense_atomic', {
      p_company_id: companyId, p_tender_id: tender.id, p_expense_type: 'bid_bond_margin',
      p_amount: 500, p_vat_amount: 0, p_bank_safe_id: A.banks, p_description: 'x', p_date: today, p_user_id: userId,
    }), 'bid_bond_margin as a tender expense is rejected (moves at bond issue)', 'غير صالح');
    await rejects(callRpc(db, 'record_tender_expense_atomic', {
      p_company_id: companyId, p_tender_id: tender.id, p_expense_type: 'nope',
      p_amount: 10, p_vat_amount: 0, p_bank_safe_id: A.banks, p_description: 'x', p_date: today, p_user_id: userId,
    }), 'unknown expense type is rejected', 'غير صالح');

    /* --- bid bond issue ------------------------------------------------------------------- */
    const bond = (await callRpc(db, 'record_bond_issue_atomic', {
      p_company_id: companyId, p_user_id: userId,
      p_payload: JSON.stringify({
        title: 'خطاب ضمان عطاء', type: 'bid_bond', amount: 2000,
        margin_amount: 2000, commission: 50, vat_amount: 7.5,
        currency: 'SAR', issue_date: today, expiry_date: d(60),
        issuing_bank: 'بنك العطاء', bank_safe_id: A.banks,
        beneficiary_name: 'جهة العطاء', tender_id: tender.id,
        reference_number: 'BND-1',
      }),
    })).rows[0].result;
    const bondRow0 = (await db.query(`SELECT status, margin_account_id FROM bonds WHERE id=$1`, [bond.bond_id])).rows[0];
    check('bond active with margin linked to 1185', bondRow0.status === 'active' && bondRow0.margin_account_id === byCode['1185'],
      JSON.stringify(bondRow0));
    const bnet = Object.fromEntries((await db.query(`
      SELECT a.code, COALESCE(SUM(jl.debit - jl.credit),0) net
      FROM journal_lines jl JOIN journal_entries je ON je.id=jl.journal_entry_id
      JOIN accounts a ON a.id=jl.account_id WHERE je.id=$1 GROUP BY a.code`, [bond.journal_entry.id])).rows.map((r) => [r.code, Number(r.net)]));
    assertBalance(bnet['1185'], 2000, 'cash margin Dr 1185 (bid bond)');
    assertBalance(bnet['5291'], 50, 'issue commission Dr 5291');
    assertBalance(bnet['1180'], 7.5, 'commission VAT Dr 1180');
    assertBalance(bnet['1121'], -2057.5, 'Cr bank (2000 + 50 + 7.50)');

    await rejects(callRpc(db, 'record_bond_issue_atomic', {
      p_company_id: companyId, p_user_id: userId,
      p_payload: JSON.stringify({
        title: 'غطاء أكبر من القيمة', type: 'bid_bond', amount: 100, margin_amount: 200,
        currency: 'SAR', issue_date: today, expiry_date: d(60), bank_safe_id: A.banks,
      }),
    }), 'margin above the bond amount is rejected', 'غير صالح');
    await rejects(callRpc(db, 'record_bond_issue_atomic', {
      p_company_id: companyId, p_user_id: userId,
      p_payload: JSON.stringify({
        title: 'تواريخ مقلوبة', type: 'bid_bond', amount: 100, margin_amount: 0,
        currency: 'SAR', issue_date: d(10), expiry_date: today, bank_safe_id: A.banks,
      }),
    }), 'expiry before issue date is rejected', 'يسبق تاريخ الإصدار');
    await rejects(callRpc(db, 'record_bond_issue_atomic', {
      p_company_id: companyId, p_user_id: userId,
      p_payload: JSON.stringify({
        title: 'نوع خاطئ', type: 'guarantee_x', amount: 100, margin_amount: 0,
        currency: 'SAR', issue_date: today, expiry_date: d(10), bank_safe_id: A.banks,
      }),
    }), 'unknown bond type is rejected', 'نوع الضمان غير صالح');

    /* --- win + convert with accounting ------------------------------------------------------- */
    await callRpc(db, 'transition_tender_atomic', { p_company_id: companyId, p_tender_id: tender.id, p_status: 'won', p_notes: 'فوز', p_user_id: userId });
    const conv = (await callRpc(db, 'convert_won_tender_with_accounting_atomic', {
      p_company_id: companyId, p_tender_id: tender.id, p_user_id: userId,
    })).rows[0].result;
    check('conversion created a project', !!conv.project_id, String(conv.project_id));
    assertBalance(conv.costs_transferred, 1000, 'only non-margin/non-commission expenses transferred (karasa 1000)');
    const convJe = (await db.query(`SELECT convert_journal_id FROM tenders WHERE id=$1`, [tender.id])).rows[0].convert_journal_id;
    check('tender row carries the conversion journal', !!convJe, String(convJe));
    const cje = (await db.query(`
      SELECT a.code, COALESCE(SUM(jl.debit - jl.credit),0) net
      FROM journal_lines jl JOIN journal_entries je ON je.id=jl.journal_entry_id
      JOIN accounts a ON a.id=jl.account_id
      WHERE je.id=$1
      GROUP BY a.code ORDER BY a.code`, [convJe])).rows;
    const cnet = Object.fromEntries(cje.map((r) => [r.code, Number(r.net)]));
    assertBalance(cnet['5195'], 1000, 'suspense moved Dr 5195 (pre-contract project costs)');
    assertBalance(cnet['5410'], -1000, 'Cr 5410 suspense cleared');
    const proj = (await db.query(`SELECT * FROM projects WHERE id=$1`, [conv.project_id])).rows[0];
    check('project linked to the tender (client, contract value)',
      !!proj && Number(proj.contract_value) === 20000, JSON.stringify({ cv: proj && proj.contract_value, st: proj && proj.status }));
    const bondRow = (await db.query(`SELECT project_id, status FROM bonds WHERE id=$1`, [bond.bond_id])).rows[0];
    check('bond re-linked to the new project', bondRow.project_id === conv.project_id, String(bondRow.project_id));
    const conv2 = (await callRpc(db, 'convert_won_tender_with_accounting_atomic', {
      p_company_id: companyId, p_tender_id: tender.id, p_user_id: userId,
    })).rows[0].result;
    check('second conversion is idempotent (no duplicate transfer)', conv2.already_processed === true && Number(conv2.costs_transferred) === 0,
      JSON.stringify({ ap: conv2.already_processed, ct: conv2.costs_transferred }));

    /* --- bond release -------------------------------------------------------------------------- */
    const rel = (await callRpc(db, 'release_bond_atomic', {
      p_company_id: companyId, p_bond_id: bond.bond_id, p_user_id: userId,
    })).rows[0].result;
    const bondAfterRel = (await db.query(`SELECT margin_amount FROM bonds WHERE id=$1`, [bond.bond_id])).rows[0];
    check('bond released (margin 2000 on the bond row)', rel.status === 'released' && rel.already_processed === false && Number(bondAfterRel.margin_amount) === 2000,
      JSON.stringify({ s: rel.status, m: bondAfterRel.margin_amount }));
    const rnet = Object.fromEntries((await db.query(`
      SELECT a.code, COALESCE(SUM(jl.debit - jl.credit),0) net
      FROM journal_lines jl JOIN journal_entries je ON je.id=jl.journal_entry_id
      JOIN accounts a ON a.id=jl.account_id WHERE je.id=$1 GROUP BY a.code`, [rel.journal_entry_id ?? rel.journal_entry?.id])).rows.map((r) => [r.code, Number(r.net)]));
    assertBalance(rnet['1121'], 2000, 'margin returned Dr bank');
    assertBalance(rnet['1185'], -2000, 'Cr 1185 margin account cleared');
    const rel2 = (await callRpc(db, 'release_bond_atomic', {
      p_company_id: companyId, p_bond_id: bond.bond_id, p_user_id: userId,
    })).rows[0].result;
    check('releasing again is a no-op', rel2.already_processed === true, JSON.stringify(rel2.already_processed));

    /* --- lost tender + draft delete --------------------------------------------------------------- */
    const lost = (await callRpc(db, 'create_tender_atomic', {
      p_company_id: companyId, p_user_id: userId,
      p_payload: JSON.stringify({ title: 'عطاء خاسر', client_name: 'عميل', contact_id: A.contacts.client, estimated_value: 500, status: 'draft' }),
    })).rows[0].result;
    await callRpc(db, 'transition_tender_atomic', { p_company_id: companyId, p_tender_id: lost.id, p_status: 'submitted', p_notes: null, p_user_id: userId });
    await callRpc(db, 'transition_tender_atomic', { p_company_id: companyId, p_tender_id: lost.id, p_status: 'lost', p_notes: 'خسارة', p_user_id: userId });
    await rejects(callRpc(db, 'convert_won_tender_with_accounting_atomic', {
      p_company_id: companyId, p_tender_id: lost.id, p_user_id: userId,
    }), 'a lost tender cannot be converted', 'الرابحة فقط');
    await rejects(callRpc(db, 'record_tender_expense_atomic', {
      p_company_id: companyId, p_tender_id: lost.id, p_expense_type: 'other',
      p_amount: 10, p_vat_amount: 0, p_bank_safe_id: A.banks, p_description: 'x', p_date: today, p_user_id: userId,
    }), 'expenses on a closed (lost) tender are rejected', 'مغلقة');

    const draft2 = (await callRpc(db, 'create_tender_atomic', {
      p_company_id: companyId, p_user_id: userId,
      p_payload: JSON.stringify({ title: 'مسودة', client_name: 'عميل', contact_id: A.contacts.client, estimated_value: 100, status: 'draft' }),
    })).rows[0].result;
    const del = (await callRpc(db, 'delete_draft_tender_atomic', {
      p_company_id: companyId, p_tender_id: draft2.id, p_user_id: userId,
    })).rows[0].result;
    check('draft tender deletes', del === true || del.deleted === true, JSON.stringify(del).slice(0, 60));
    await rejects(callRpc(db, 'delete_draft_tender_atomic', {
      p_company_id: companyId, p_tender_id: tender.id, p_user_id: userId,
    }), 'deleting a non-draft tender is rejected', '');

    /* --- bond summary report ------------------------------------------------------------------------ */
    const sum = (await db.query(`SELECT get_bond_summary($1::uuid) r`, [companyId])).rows[0].r;
    check('bond summary report returns', !!sum, JSON.stringify(sum).slice(0, 100));

    /* --- invariants -------------------------------------------------------------------------------------- */
    await invDoubleEntry(db, companyId);
    await invTrialBalance(db, companyId);
  }
}
