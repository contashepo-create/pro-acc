/**
 * Section 12 — Payroll & Salary Sheets (الرواتب)
 *
 * Engine: 049 (salary sheets + original batch), 057 (tenant guard wrapper),
 * 096/104/105 (GOSI/EOSB social insurance, final), 105 (accounts + withholding
 * hardening). Accounting semantics under audit:
 *   - post_payroll_batch(company, date, employee_ids[], created_by):
 *       one payroll row per employee per calendar month (duplicate month →
 *       reject), advance deduction = LEAST(open advances, 50% of salary)
 *       settled FIFO against employee_advances.remaining_amount, social
 *       insurance per country (SA GOSI 11.75%/9.75%, EG EOSB 18.75%/11%,
 *       overridable via settings gosi_*_rate).
 *       JE: Dr 5210 total salary
 *           Cr 2140 (salary − advances − SI employee)
 *           Cr 1160 advances settled (if any)
 *           Dr 5215 SI employer share / Cr 2155 (employer + employee SI)
 *       reference_type 'payroll_batch'.
 *   - create_salary_sheet (072): draft sheet + items
 *     (net = basic + allowances − deductions, non-negative, 2dp, active
 *     employee, optional ACTIVE project); delete only while draft. Sheets
 *     reach 'approved' through the approval workflow (section 23).
 */
import { callRpc, check, assertBalance, rejects, seedTenant, invDoubleEntry, invTrialBalance } from '../framework.mjs';

export const name = '12 Payroll & Salary Sheets (الرواتب)';

async function makeEmployee(db, A, name, salary, date) {
  const r = (await callRpc(db, 'create_employee_atomic', {
    p_company_id: A.companyId, p_name: name, p_phone: '01500000000',
    p_email: null, p_salary: salary, p_department: 'رواتب', p_position: 'موظف',
    p_hire_date: '2025-01-01', p_user_id: A.userId,
  })).rows[0].result;
  return r.id;
}

async function openAdvance(db, A, employeeId, amount, date) {
  // dedicated advance RPC: Dr 1160 / Cr safe + employee_advances ledger row
  return callRpc(db, 'create_employee_advance', {
    p_company_id: A.companyId, p_employee_id: employeeId, p_date: date,
    p_amount: amount, p_reason: 'سلفة راتب', p_bank_safe_id: A.safe,
    p_created_by: A.userId,
  });
}

export async function run({ db }) {
  {
    const A = await seedTenant(db, { name: 'مراجعة 12', email: 'audit12@example.test' });
    const { companyId, userId } = A;
    const date = '2026-07-15';

    /* --- SA batch: two employees, one with FIFO advances --------------------- */
    const e1 = await makeEmployee(db, A, 'موظف أول', 10000, date);
    const e2 = await makeEmployee(db, A, 'موظف ثانٍ', 8000, date);
    await openAdvance(db, A, e2, 2000, '2026-05-01');
    await openAdvance(db, A, e2, 3000, '2026-06-01');

    const batch = (await callRpc(db, 'post_payroll_batch', {
      p_company_id: companyId, p_date: date,
      p_employee_ids: [e1, e2], p_created_by: userId,
    })).rows[0].result;
    assertBalance(batch.total_salary, 18000, 'total salary 10000+8000');
    assertBalance(batch.total_advance_deduction, 4000, 'advance deduction capped at 50% of salary (min(5000, 4000))');
    assertBalance(batch.total_gosi_employer, 2115, 'GOSI employer 11.75% (1175+940)');
    assertBalance(batch.total_gosi_employee, 1755, 'GOSI employee 9.75% (975+780)');

    const je = batch.journal_entry_id;
    const jeAccs = (await db.query(`
      SELECT a.code, COALESCE(SUM(jl.debit - jl.credit),0) net
      FROM journal_lines jl JOIN accounts a ON a.id=jl.account_id
      WHERE jl.journal_entry_id=$1 GROUP BY a.code ORDER BY a.code`, [je])).rows;
    const net = Object.fromEntries(jeAccs.map((r) => [r.code, Number(r.net)]));
    assertBalance(net['5210'], 18000, 'JE Dr 5210 total salary');
    assertBalance(net['2140'], -12245, 'JE Cr 2140 (18000 − 4000 − 1755)');
    assertBalance(net['1160'], -4000, 'JE Cr 1160 advances settled');
    assertBalance(net['5215'], 2115, 'JE Dr 5215 SI employer share');
    assertBalance(net['2155'], -3870, 'JE Cr 2155 (2115 + 1755)');
    check('payroll JE reference type', (await db.query(`SELECT reference_type FROM journal_entries WHERE id=$1`, [je])).rows[0].reference_type === 'payroll_batch', '');

    const rows = (await db.query(`SELECT * FROM payroll WHERE journal_entry_id=$1 ORDER BY employee_id`, [je])).rows;
    check('two payroll rows', rows.length === 2, String(rows.length));
    const byEmp = Object.fromEntries(rows.map((r) => [r.employee_id, r]));
    assertBalance(byEmp[e1].net_pay, 9025, 'e1 net = 10000 − 0 − 975');
    assertBalance(byEmp[e2].net_pay, 3220, 'e2 net = 8000 − 4000 − 780');
    assertBalance(byEmp[e2].advance_deduction, 4000, 'e2 advance deduction recorded');

    const adv = (await db.query(`SELECT remaining_amount FROM employee_advances
      WHERE company_id=$1 AND employee_id=$2 AND remaining_amount>0 ORDER BY date`, [companyId, e2])).rows;
    check('advances settled FIFO: 2000 fully, 3000 → 1000 left',
      adv.length === 1 && Number(adv[0].remaining_amount) === 1000, JSON.stringify(adv));

    /* --- batch guards ----------------------------------------------------------- */
    await rejects(callRpc(db, 'post_payroll_batch', {
      p_company_id: companyId, p_date: '2026-07-20', p_employee_ids: [e1], p_created_by: userId,
    }), 'same employee twice in the same month is rejected', 'مسبقاً');
    await rejects(callRpc(db, 'post_payroll_batch', {
      p_company_id: companyId, p_date: date, p_employee_ids: [e1, e1], p_created_by: userId,
    }), 'duplicate employee in one batch is rejected', 'تكرار');
    const e3 = await makeEmployee(db, A, 'موظف ثالث', 5000, date);
    await callRpc(db, 'deactivate_employee_atomic', { p_company_id: companyId, p_employee_id: e3, p_user_id: userId });
    await rejects(callRpc(db, 'post_payroll_batch', {
      p_company_id: companyId, p_date: date, p_employee_ids: [e3], p_created_by: userId,
    }), 'inactive employee is rejected', 'غير موجود أو غير نشط');
    const e4 = await makeEmployee(db, A, 'موظف بلا راتب', 0, date);
    await rejects(callRpc(db, 'post_payroll_batch', {
      p_company_id: companyId, p_date: date, p_employee_ids: [e4], p_created_by: userId,
    }), 'zero salary is rejected', 'غير صالح');
    await rejects(callRpc(db, 'post_payroll_batch', {
      p_company_id: companyId, p_date: date, p_employee_ids: [], p_created_by: userId,
    }), 'empty batch is rejected', 'غير صالحة');

    /* --- EG batch: EOSB rates ---------------------------------------------------- */
    const E = await seedTenant(db, { name: 'مراجعة 12 مصر', email: 'audit12eg@example.test', country: 'EG' });
    const eEg = (await callRpc(db, 'create_employee_atomic', {
      p_company_id: E.companyId, p_name: 'موظف مصري', p_phone: '01500000001',
      p_email: null, p_salary: 10000, p_department: 'رواتب', p_position: 'موظف',
      p_hire_date: '2025-01-01', p_user_id: E.userId,
    })).rows[0].result.id;
    const batchEg = (await callRpc(db, 'post_payroll_batch', {
      p_company_id: E.companyId, p_date: '2026-08-05',
      p_employee_ids: [eEg], p_created_by: E.userId,
    })).rows[0].result;
    assertBalance(batchEg.total_gosi_employer, 1875, 'EG EOSB employer 18.75%');
    assertBalance(batchEg.total_gosi_employee, 1100, 'EG EOSB employee 11%');
    const rowEg = (await db.query(`SELECT net_pay FROM payroll WHERE journal_entry_id=$1`, [batchEg.journal_entry_id])).rows[0];
    assertBalance(rowEg.net_pay, 8900, 'EG net = 10000 − 1100');
    const jeEg = (await db.query(`
      SELECT a.code, COALESCE(SUM(jl.debit - jl.credit),0) net
      FROM journal_lines jl JOIN accounts a ON a.id=jl.account_id
      WHERE jl.journal_entry_id=$1 GROUP BY a.code`, [batchEg.journal_entry_id])).rows;
    const netEg = Object.fromEntries(jeEg.map((r) => [r.code, Number(r.net)]));
    assertBalance(netEg['2140'], -8900, 'EG Cr 2140 net pay');
    assertBalance(netEg['2155'], -2975, 'EG Cr 2155 (1875 + 1100)');

    /* --- salary sheets --------------------------------------------------------------- */
    const sheet = (await callRpc(db, 'create_salary_sheet', {
      p_company_id: companyId, p_name: 'راتب يوليو', p_month: 7, p_year: 2026,
      p_date: date,
      p_items: JSON.stringify([
        { employee_id: e1, basic_salary: 5000, allowances: 500, deductions: 200 },
        { employee_id: e2, basic_salary: 4000, allowances: 0, deductions: 0 },
      ]),
    })).rows[0].result;
    check('sheet created as draft', sheet.status === 'draft', sheet.status);
    const items = (await db.query(`SELECT * FROM salary_items WHERE sheet_id=$1 ORDER BY employee_id`, [sheet.id])).rows;
    check('sheet items stored', items.length === 2, String(items.length));
    const byEmp2 = Object.fromEntries(items.map((r) => [r.employee_id, r]));
    assertBalance(byEmp2[e1].net_pay, 5300, 'item net = 5000 + 500 − 200');
    assertBalance(byEmp2[e2].net_pay, 4000, 'item net plain');

    await rejects(callRpc(db, 'create_salary_sheet', {
      p_company_id: companyId, p_name: 'شهر خاطئ', p_month: 13, p_year: 2026, // distinct period (uq per month/year)
      p_date: date, p_items: JSON.stringify([{ employee_id: e1, basic_salary: 100, allowances: 0, deductions: 0 }]),
    }), 'month outside 1-12 is rejected', 'غير صالحة');
    await rejects(callRpc(db, 'create_salary_sheet', {
      p_company_id: companyId, p_name: 'صافي سالب', p_month: 8, p_year: 2026, // distinct period (uq per month/year)
      p_date: date, p_items: JSON.stringify([{ employee_id: e1, basic_salary: 100, allowances: 0, deductions: 200 }]),
    }), 'negative net pay item is rejected', 'غير صالح');
    await rejects(callRpc(db, 'create_salary_sheet', {
      p_company_id: companyId, p_name: 'موظف معطّل', p_month: 9, p_year: 2026, // distinct period (uq per month/year)
      p_date: date, p_items: JSON.stringify([{ employee_id: e3, basic_salary: 100, allowances: 0, deductions: 0 }]),
    }), 'item with inactive employee is rejected', 'غير موجود أو غير نشط');

    const del = (await callRpc(db, 'delete_draft_salary_sheet', {
      p_company_id: companyId, p_sheet_id: sheet.id,
    })).rows[0].result;
    check('draft sheet deletes', del === true, String(del));
    const gone = (await db.query(`SELECT count(*)::int c FROM salary_sheets WHERE id=$1`, [sheet.id])).rows[0].c;
    check('deleted sheet is gone', gone === 0, String(gone));

    /* --- invariants --------------------------------------------------------------------- */
    await invDoubleEntry(db, companyId);
    await invTrialBalance(db, companyId);
    await invDoubleEntry(db, E.companyId);
    await invTrialBalance(db, E.companyId);
  }
}
