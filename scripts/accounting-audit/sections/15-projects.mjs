/**
 * Section 15 — Projects, Costs & Progress Billing (المشاريع والمستخلصات)
 *
 * Engine: 049 (post/cancel project expense + close_project), 050 (progress
 * billing + cancel_empty_project), 058 (tenant-guard wrappers), 061 (budgets),
 * 071/072 (project-cost integrity).
 * Accounting semantics under audit:
 *   - post_project_expense: Dr chosen expense account amount / Dr 1180 tax
 *     (if rate > 0) / Cr bank|safe|1110 (amount + tax); project must be
 *     active; payment-account balance enforced (get_account_balance).
 *     project_expenses row 'posted'; JE reference 'project_expense'.
 *     cancel → reversal + status 'rejected'.
 *   - create_progress_billing_atomic: cumulative claim cap =
 *     contract_value + approved change orders; retention parked in 2160
 *     (NOT revenue), revenue recognized on net (gross − retention):
 *     Dr 1135 (gross + tax) / Cr 4100 net / Cr 2160 retention / Cr 2120 tax.
 *     One final claim per project; auto numbering PB-000001…
 *   - close_project: zeroes every project-tagged revenue/expense account
 *     balance dated ≤ close date into 3200 retained earnings (Cr profit /
 *     Dr loss), reference 'project_closure'; status 'completed'.
 *   - cancel_empty_project_atomic: only while the project has no financial
 *     footprints (invoices, PI, claims, expenses, JE lines).
 */
import { callRpc, check, assertBalance, rejects, seedTenant, invDoubleEntry, invTrialBalance } from '../framework.mjs';

export const name = '15 Projects & Costs (المشاريع)';

const mkProject = (db, A, name, contract, extra = {}) => callRpc(db, 'create_project_atomic', {
  p_company_id: A.companyId, p_name: name, p_client_id: A.contacts.client,
  p_contract_value: contract, p_start_date: '2026-07-01', p_end_date: '2026-12-31',
  p_status: 'active', p_description: null, p_location: null,
  p_items: JSON.stringify([{ description: 'مرحلة', quantity: 1, unit_price: contract }]),
  p_auto_invoice: false, p_user_id: A.userId, ...extra,
});

export async function run({ db }) {
  {
    const A = await seedTenant(db, { name: 'مراجعة 15', email: 'audit15@example.test' });
    const { companyId, userId, byCode } = A;
    const date = '2026-07-20';
    // close_project sums JE lines dated <= close date, and post_journal_reversal
    // stamps reversals with CURRENT_DATE — close at today so cancelled entries net out.
    const today = new Date().toISOString().slice(0, 10);

    const p1 = (await mkProject(db, A, 'مشروع الإغلاق', 10000)).rows[0].result;
    check('project created active with contract value', p1.status === 'active' && Number(p1.contract_value) === 10000,
      JSON.stringify({ s: p1.status, cv: p1.contract_value }));

    /* --- project expense ------------------------------------------------------------ */
    const exp = (await callRpc(db, 'post_project_expense', {
      p_company_id: companyId, p_project_id: p1.id, p_expense_type: 'materials',
      p_description: 'مواد بناء', p_amount: 5000, p_date: date,
      p_contact_id: A.contacts.supplier, p_bank_safe_id: A.banks,
      p_expense_account_id: byCode['5400'], p_notes: null, p_tax_rate: 0.15,
      p_created_by: userId,
    })).rows[0].result;
    check('expense posted', exp.status === 'posted' && Number(exp.tax_amount) === 750, JSON.stringify({ s: exp.status, t: exp.tax_amount }));
    const eje = (await db.query(`
      SELECT a.code, COALESCE(SUM(jl.debit - jl.credit),0) net
      FROM journal_lines jl JOIN journal_entries je ON je.id=jl.journal_entry_id
      JOIN accounts a ON a.id=jl.account_id
      WHERE je.id=$1 GROUP BY a.code ORDER BY a.code`, [exp.journal_entry_id])).rows;
    const enet = Object.fromEntries(eje.map((r) => [r.code, Number(r.net)]));
    assertBalance(enet['5400'], 5000, 'Dr expense 5000 (project-tagged)');
    assertBalance(enet['1180'], 750, 'Dr input VAT 750');
    assertBalance(enet['1121'], -5750, 'Cr bank 5750');
    const taggedLine = (await db.query(`
      SELECT project_id FROM journal_lines WHERE journal_entry_id=$1 AND account_id=$2`, [exp.journal_entry_id, byCode['5400']]));
    check('expense lines carry the project tag', taggedLine.rows[0].project_id === p1.id, String(taggedLine.rows[0].project_id));

    await rejects(callRpc(db, 'post_project_expense', {
      p_company_id: companyId, p_project_id: p1.id, p_expense_type: 'x',
      p_description: 'زائد عن الرصيد', p_amount: 99999999, p_date: date,
      p_contact_id: null, p_bank_safe_id: A.banks,
      p_expense_account_id: byCode['5400'], p_notes: null, p_tax_rate: 0,
      p_created_by: userId,
    }), 'expense exceeding the payment balance is rejected', 'غير كاف');
    const pHold = (await mkProject(db, A, 'مشروع موقوف', 1000, { p_status: 'on_hold' })).rows[0].result;
    await rejects(callRpc(db, 'post_project_expense', {
      p_company_id: companyId, p_project_id: pHold.id, p_expense_type: 'x',
      p_description: 'على موقوف', p_amount: 10, p_date: date,
      p_contact_id: null, p_bank_safe_id: A.banks,
      p_expense_account_id: byCode['5400'], p_notes: null, p_tax_rate: 0,
      p_created_by: userId,
    }), 'expense on a non-active project is rejected', 'غير نشط');
    await rejects(callRpc(db, 'post_project_expense', {
      p_company_id: companyId, p_project_id: p1.id, p_expense_type: 'x',
      p_description: 'ضريبة مفرطة', p_amount: 10, p_date: date,
      p_contact_id: null, p_bank_safe_id: A.banks,
      p_expense_account_id: byCode['5400'], p_notes: null, p_tax_rate: 1.5,
      p_created_by: userId,
    }), 'tax rate > 1 is rejected', 'غير صالحة');

    const cancelExp = (await callRpc(db, 'cancel_project_expense', {
      p_company_id: companyId, p_expense_id: exp.id, p_user_id: userId,
    })).rows[0].result;
    check('expense cancelled with a reversal', cancelExp.cancelled === true && !!cancelExp.reversal_journal_id, '');
    const expNet = (await db.query(`
      SELECT a.code, COALESCE(SUM(jl.debit - jl.credit),0) net
      FROM journal_lines jl JOIN journal_entries je ON je.id=jl.journal_entry_id
      JOIN accounts a ON a.id=jl.account_id
      WHERE je.company_id=$1 AND a.code IN ('5400','1180','1121') AND je.reference_type IN ('project_expense','project_expense_cancellation')
      GROUP BY a.code`, [companyId])).rows;
    check('expense + reversal net out', expNet.every((r) => Number(r.net) === 0), JSON.stringify(expNet));

    /* --- progress billing ------------------------------------------------------------- */
    const claim1 = (await callRpc(db, 'create_progress_billing_atomic', {
      p_company_id: companyId, p_project_id: p1.id, p_date: date,
      p_claim_number: null, p_description: 'مستخلص 25%',
      p_gross_amount: 4000, p_retention_rate: 0.1, p_tax_rate: 0.15,
      p_is_final: false, p_user_id: userId,
    })).rows[0].result;
    check('claim numbered PB-000001', claim1.claim_number === 'PB-000001', claim1.claim_number);
    assertBalance(claim1.retention_amount, 400, 'retention 10% of 4000');
    assertBalance(claim1.net_amount, 3600, 'net = gross − retention');
    assertBalance(claim1.tax_amount, 540, 'tax 15% on the NET');
    const cje = (await db.query(`
      SELECT a.code, COALESCE(SUM(jl.debit - jl.credit),0) net
      FROM journal_lines jl JOIN journal_entries je ON je.id=jl.journal_entry_id
      JOIN accounts a ON a.id=jl.account_id
      WHERE je.id=$1 GROUP BY a.code ORDER BY a.code`, [claim1.journal_entry_id])).rows;
    const cnet = Object.fromEntries(cje.map((r) => [r.code, Number(r.net)]));
    assertBalance(cnet['1135'], 4540, 'Dr 1135 (gross + tax)');
    assertBalance(cnet['4100'], -3600, 'Cr 4100 revenue on NET (retention is not revenue)');
    assertBalance(cnet['2160'], -400, 'Cr 2160 retention parked as liability');
    assertBalance(cnet['2120'], -540, 'Cr 2120 VAT');
    check('claim JE balanced', Math.abs(Object.values(cnet).reduce((s, v) => s + v, 0)) < 0.005, JSON.stringify(cnet));

    const claim2 = (await callRpc(db, 'create_progress_billing_atomic', {
      p_company_id: companyId, p_project_id: p1.id, p_date: date,
      p_claim_number: 'PB-000002', p_description: 'مستخلص 35%',
      p_gross_amount: 3500, p_retention_rate: 0.1, p_tax_rate: 0.15,
      p_is_final: false, p_user_id: userId,
    })).rows[0].result;
    check('second claim within contract cap', claim2.status === 'approved', claim2.status);
    await rejects(callRpc(db, 'create_progress_billing_atomic', {
      p_company_id: companyId, p_project_id: p1.id, p_date: date,
      p_claim_number: null, p_description: 'تجاوز',
      p_gross_amount: 2501, p_retention_rate: 0, p_tax_rate: 0,
      p_is_final: false, p_user_id: userId,
    }), 'claim exceeding contract + change orders is rejected', 'تتجاوز العقد');

    /* final-claim uniqueness on a second project */
    const p2 = (await mkProject(db, A, 'مشروع نهائي', 1000)).rows[0].result;
    const fin = (await callRpc(db, 'create_progress_billing_atomic', {
      p_company_id: companyId, p_project_id: p2.id, p_date: date,
      p_claim_number: null, p_description: 'مستخلص نهائي',
      p_gross_amount: 1000, p_retention_rate: 0, p_tax_rate: 0,
      p_is_final: true, p_user_id: userId,
    })).rows[0].result;
    check('final claim posted', fin.is_final === true && fin.status === 'approved', JSON.stringify({ f: fin.is_final }));
    await rejects(callRpc(db, 'create_progress_billing_atomic', {
      p_company_id: companyId, p_project_id: p2.id, p_date: date,
      p_claim_number: null, p_description: 'بعد النهائي',
      p_gross_amount: 1, p_retention_rate: 0, p_tax_rate: 0,
      p_is_final: false, p_user_id: userId,
    }), 'any claim after the final one is rejected', 'مستخلص نهائي');
    await rejects(callRpc(db, 'create_progress_billing_atomic', {
      p_company_id: companyId, p_project_id: pHold.id, p_date: date,
      p_claim_number: null, p_description: 'على موقوف',
      p_gross_amount: 1, p_retention_rate: 0, p_tax_rate: 0,
      p_is_final: false, p_user_id: userId,
    }), 'claiming on a non-active project is rejected', 'غير صالح للفوترة المرحلية');

    /* --- close project: P&L lines to 3200 ------------------------------------------------- */
    // re-post the expense so the project has costs when closed
    const exp2 = (await callRpc(db, 'post_project_expense', {
      p_company_id: companyId, p_project_id: p1.id, p_expense_type: 'materials',
      p_description: 'مواد بناء (بعد الإلغاء)', p_amount: 5000, p_date: date,
      p_contact_id: null, p_bank_safe_id: A.banks,
      p_expense_account_id: byCode['5400'], p_notes: null, p_tax_rate: 0,
      p_created_by: userId,
    })).rows[0].result;
    // project p1 revenue so far: claims 3600 + 3150 (net of 3500×0.9) = 6750
    const close = (await callRpc(db, 'close_project', {
      p_company_id: companyId, p_project_id: p1.id, p_close_date: today,
      p_notes: 'إقفال المراجعة', p_user_id: userId,
    })).rows[0].result;
    assertBalance(close.total_revenue, 6750, 'closed revenue = sum of claim nets');
    assertBalance(close.total_expenses, 5000, 'closed expenses');
    assertBalance(close.net_profit, 1750, 'net profit 6750 − 5000');
    const clje = (await db.query(`
      SELECT a.code, COALESCE(SUM(jl.debit - jl.credit),0) net
      FROM journal_lines jl JOIN journal_entries je ON je.id=jl.journal_entry_id
      JOIN accounts a ON a.id=jl.account_id
      WHERE je.id=$1 GROUP BY a.code ORDER BY a.code`, [close.closure_journal_entry_id])).rows;
    const clnet = Object.fromEntries(clje.map((r) => [r.code, Number(r.net)]));
    assertBalance(clnet['4100'], 6750, 'closing zeros revenue (Dr 4100)');
    assertBalance(clnet['5400'], -5000, 'closing zeros expense (Cr 5400)');
    assertBalance(clnet['3200'], -1750, 'net profit to retained earnings (Cr 3200)');
    check('closure JE reference project_closure', (await db.query(`
      SELECT reference_type FROM journal_entries WHERE id=$1`, [close.closure_journal_entry_id])).rows[0].reference_type === 'project_closure', '');
    const p1row = (await db.query(`SELECT status, end_date, closure_journal_entry_id FROM projects WHERE id=$1`, [p1.id])).rows[0];
    check('project completed with closure journal', p1row.status === 'completed' && p1row.closure_journal_entry_id === close.closure_journal_entry_id,
      JSON.stringify(p1row.status));
    await rejects(callRpc(db, 'close_project', {
      p_company_id: companyId, p_project_id: p1.id, p_close_date: today, p_notes: null, p_user_id: userId,
    }), 'closing again is rejected', 'مكتمل بالفعل');
    await rejects(callRpc(db, 'post_project_expense', {
      p_company_id: companyId, p_project_id: p1.id, p_expense_type: 'x',
      p_description: 'بعد الإقفال', p_amount: 5, p_date: date,
      p_contact_id: null, p_bank_safe_id: A.banks,
      p_expense_account_id: byCode['5400'], p_notes: null, p_tax_rate: 0,
      p_created_by: userId,
    }), 'expense after completion is rejected (not active)', 'غير نشط');

    /* --- cancel-empty guards ----------------------------------------------------------------- */
    const p3 = (await mkProject(db, A, 'مشروع فارغ', 500)).rows[0].result;
    const canc = (await callRpc(db, 'cancel_empty_project_atomic', {
      p_company_id: companyId, p_project_id: p3.id, p_user_id: userId,
    })).rows[0].result;
    check('empty project cancels', canc.status === 'cancelled', canc.status);
    await rejects(callRpc(db, 'cancel_empty_project_atomic', {
      p_company_id: companyId, p_project_id: p2.id, p_user_id: userId,
    }), 'project with financial footprints cannot be cancelled', 'آثار مالية');
    await rejects(callRpc(db, 'cancel_empty_project_atomic', {
      p_company_id: companyId, p_project_id: p1.id, p_user_id: userId,
    }), 'completed project cannot be cancelled', 'مكتمل ولا يمكن');

    /* --- profitability view ------------------------------------------------------------------------- */
    /* --- reporting views on the closed project ---------------------------------------------------- */
    const tot = (await db.query(`
      SELECT code, debit, credit FROM get_project_account_totals($1::uuid, ARRAY[$2::uuid], NULL, NULL)
      WHERE code IN ('4100','5400')`, [companyId, p1.id])).rows;
    const totMap = Object.fromEntries(tot.map((r) => [r.code, r]));
    check('account totals: revenue & expense fully netted by the closure JE',
      totMap['4100'] && totMap['5400'] &&
      Number(totMap['4100'].debit) === Number(totMap['4100'].credit) &&
      Number(totMap['5400'].debit) === Number(totMap['5400'].credit),
      JSON.stringify(tot));
    const billedRows = (await db.query(`
      SELECT billed, credits, net_billed FROM get_project_billing_totals($1::uuid, ARRAY[$2::uuid]) WHERE project_id=$2`,
      [companyId, p1.id])).rows;
    const billed = billedRows[0];
    check('billing totals report counts invoices only — progress claims are separate (no invoices here)',
      billedRows.length === 0 || billed.billed === null || Number(billed.billed) === 0, JSON.stringify(billedRows));

    /* --- invariants ----------------------------------------------------------------------------------- */
    await invDoubleEntry(db, companyId);
    await invTrialBalance(db, companyId);
  }
}
