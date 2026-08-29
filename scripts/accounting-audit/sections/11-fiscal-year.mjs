/**
 * Section 11 — Fiscal Years & Closing (السنة المالية والإقفال)
 *
 * Engine: 050 (close/reopen + close guard set), 069 (create_fiscal_year_atomic),
 * 104/106/107 (per-country fiscal calendars), 047 (enforce_open_fiscal_year on
 * every posted date). Accounting semantics under audit:
 *   - One open fiscal year at a time; no overlapping periods.
 *   - Close: every revenue/expense account balance within [start, end]
 *     (excluding 'closing' JEs and reopen-reversal JEs) is zeroed by a
 *     type='closing' JE dated the year end: Dr/Cr each account + net line to
 *     3200 retained earnings (Cr profit / Dr loss). reference_type
 *     'fiscal_year_closing'.
 *   - Close guards: older open years first, open CUSTODIES block the close,
 *     active projects are a warning only.
 *   - Reopen: allowed only when no NEWER year is closed; reverses every
 *     'closing' JE in the range (reference 'fiscal_year_reopen') so the
 *     P&L accounts and 3200 return to exactly zero net, and the year can be
 *     closed again with identical figures (the reopen JEs are filtered out
 *     of the balance computation).
 */
import { callRpc, check, assertBalance, rejects, seedTenant, invDoubleEntry, invTrialBalance } from '../framework.mjs';

export const name = '11 Fiscal Years & Closing (السنة المالية)';

export async function run({ db }) {
  {
    const A = await seedTenant(db, { name: 'مراجعة 11', email: 'audit11@example.test' });
    const { companyId, userId, banks, safe, contacts } = A;
    const client = contacts.client;

    const fy1 = (await db.query(`SELECT * FROM fiscal_years WHERE company_id=$1 AND status='open'`, [companyId])).rows[0];
    check('bootstrap created exactly one open fiscal year', !!fy1 &&
      (await db.query(`SELECT count(*)::int c FROM fiscal_years WHERE company_id=$1 AND status='open'`, [companyId])).rows[0].c === 1,
      fy1 ? `${fy1.start_date} → ${fy1.end_date}` : 'none');

    const norm = (v) => (v instanceof Date ? v.toISOString().slice(0, 10) : String(v)).slice(0, 10);
    const d = (dateStr, days) => new Date(new Date(norm(dateStr) + 'T00:00:00Z').getTime() + days * 86400000).toISOString().slice(0, 10);
    const beforeFy = d(fy1.start_date, -1);
    const d1 = d(fy1.start_date, 40);
    const d2 = d(fy1.start_date, 45);

    /* --- 1. open-FY enforcement on posting ----------------------------------- */
    await rejects(callRpc(db, 'create_journal_entry', {
      p_company_id: companyId, p_date: beforeFy, p_type: 'general',
      p_description: 'خارج السنة', p_created_by: userId,
      p_lines: JSON.stringify([{ accountId: A.byCode['1110'], debit: 10, credit: 0 },
                               { accountId: A.byCode['3100'], debit: 0, credit: 10 }]),
    }), 'a JE dated before the open FY is rejected', 'سنة مالية');

    /* --- 2. creation guards ---------------------------------------------------- */
    const fy2Range = { start: d(fy1.end_date, 1), end: d(d(fy1.end_date, 1), 364) };
    await rejects(callRpc(db, 'create_fiscal_year_atomic', {
      p_company_id: companyId, p_name: 'تداخل', p_start_date: d(fy1.start_date, 10),
      p_end_date: d(fy1.start_date, 20), p_user_id: userId,
    }), 'overlapping fiscal year is rejected', 'تتداخل');
    await rejects(callRpc(db, 'create_fiscal_year_atomic', {
      p_company_id: companyId, p_name: 'عام ثانٍ', p_start_date: fy2Range.start,
      p_end_date: fy2Range.end, p_user_id: userId,
    }), 'a second open fiscal year is rejected', 'أكثر من سنة');

    /* --- 3. P&L activity inside the year --------------------------------------- */
    // Revenue: 10×100 @15% → Dr 1130 1150 / Cr 4100 1000 / Cr 2120 150
    const inv = (await callRpc(db, 'create_sales_invoice_atomic', {
      p_company_id: companyId, p_contact_id: client, p_project_id: null,
      p_date: d1, p_due_date: d1,
      p_items: JSON.stringify([{ description: 'خدمة', quantity: 10, unitPrice: 100 }]),
      p_vat_rate: 0.15, p_vat_enabled: true, p_notes: null,
      p_collected_amount: 0, p_bank_safe_id: null, p_user_id: userId,
    })).rows[0].result;
    check('revenue invoice posted', Number(inv.total) === 1150, String(inv.total));
    // Expense: 300 to the safe (type 'other' → 5100)
    const dis = (await callRpc(db, 'create_voucher_disbursement_atomic', {
      p_company_id: companyId, p_date: d2, p_disbursement_type: 'other',
      p_contact_id: null, p_employee_id: null, p_amount: 300,
      p_bank_safe_id: safe, p_reason: 'مصاريف إقفال',
      p_allocations: '[]', p_request_approval: false, p_user_id: userId,
    })).rows[0].result;
    check('expense disbursement posted', Number(dis.amount) === 300, String(dis.amount));
    const pl = (await db.query(`
      SELECT a.code, COALESCE(SUM(jl.debit - jl.credit),0) net
      FROM journal_lines jl JOIN journal_entries je ON je.id=jl.journal_entry_id
      JOIN accounts a ON a.id=jl.account_id
      WHERE je.company_id=$1 AND a.code IN ('4100','5400') AND je.date BETWEEN $2::date AND $3::date
      GROUP BY a.code`, [companyId, fy1.start_date, fy1.end_date])).rows;
    const plNet = Object.fromEntries(pl.map((r) => [r.code, Number(r.net)]));
    assertBalance(plNet['4100'], -1000, 'revenue net within the year (credit side)');
    assertBalance(plNet['5400'], 300, 'expense net within the year (debit side; type other → 5400)');

    /* --- 4. active project → warning, not a block ------------------------------ */
    await callRpc(db, 'create_project_atomic', {
      p_company_id: companyId, p_name: 'مشروع قيد الإقفال', p_client_id: client,
      p_contract_value: 5000, p_start_date: d1, p_end_date: fy1.end_date,
      p_status: 'active', p_description: null, p_location: null,
      p_items: JSON.stringify([{ description: 'مرحلة', quantity: 1, unit_price: 5000 }]),
      p_auto_invoice: false, p_user_id: userId,
    });

    /* --- 5. open custody blocks the close -------------------------------------- */
    const emp = (await callRpc(db, 'create_employee_atomic', {
      p_company_id: companyId, p_name: 'موظف عهدة', p_phone: '01122223333',
      p_email: null, p_salary: 5000, p_department: 'مراجعة', p_position: 'عامل',
      p_hire_date: '2025-01-01', p_user_id: userId,
    })).rows[0].result.id;
    const custody = (await callRpc(db, 'open_custody_file', {
      p_company_id: companyId, p_employee_id: emp, p_date: d1, p_amount: 50,
      p_reason: 'عهدة اختبار الإقفال', p_bank_safe_id: safe, p_project_id: null,
      p_created_by: userId,
    })).rows[0].result.id;
    await rejects(callRpc(db, 'close_fiscal_year_atomic', {
      p_company_id: companyId, p_fiscal_year_id: fy1.id, p_user_id: userId,
    }), 'close is blocked while a custody is open', 'العهد مفتوحة');
    await callRpc(db, 'settle_custody_file', {
      p_company_id: companyId, p_custody_id: custody, p_date: d1,
      p_returned_cash: 50, p_bank_safe_id: safe, p_description: 'تسوية العهدة',
      p_created_by: userId,
    });
    const custodyRow = (await db.query(`SELECT status FROM custodies WHERE id=$1`, [custody])).rows[0];
    check('custody settled before the close', custodyRow.status === 'settled', custodyRow.status);

    /* --- 6. the close itself ------------------------------------------------------ */
    const close = (await callRpc(db, 'close_fiscal_year_atomic', {
      p_company_id: companyId, p_fiscal_year_id: fy1.id, p_user_id: userId,
    })).rows[0].result;
    check('year closed', close.status === 'closed', close.status);
    check('close returns the closing JE id', !!close.closing_journal_id, String(close.closing_journal_id));
    assertBalance(close.totalRevenue, 1000, 'returned totalRevenue');
    assertBalance(close.totalExpenses, 300, 'returned totalExpenses');
    assertBalance(close.netIncome, 700, 'returned netIncome (1000 − 300)');
    check('active-project warning surfaced', Array.isArray(close.warnings) && close.warnings.length === 1, JSON.stringify(close.warnings));

    const cje = (await db.query(`
      SELECT je.type, je.date, je.reference_type
      FROM journal_entries je WHERE je.id=$1`, [close.closing_journal_id])).rows[0];
    check('closing JE: type closing, dated year end, reference fiscal_year_closing',
      cje.type === 'closing' && norm(cje.date) === norm(fy1.end_date) && cje.reference_type === 'fiscal_year_closing',
      JSON.stringify(cje));
    const cjeLines = (await db.query(`
      SELECT a.code, COALESCE(SUM(jl.debit - jl.credit),0) net
      FROM journal_lines jl JOIN accounts a ON a.id=jl.account_id
      WHERE jl.journal_entry_id=$1 GROUP BY a.code ORDER BY a.code`, [close.closing_journal_id])).rows;
    const cjNet = Object.fromEntries(cjeLines.map((r) => [r.code, Number(r.net)]));
    assertBalance(cjNet['4100'], 1000, 'closing JE zeros revenue (Dr 4100 1000)');
    assertBalance(cjNet['5400'], -300, 'closing JE zeros expense (Cr 5400 300)');
    assertBalance(cjNet['3200'], -700, 'net profit parked in retained earnings (Cr 3200 700)');
    check('closing JE touches only P&L + 3200', cjeLines.length === 3, JSON.stringify(cjeLines.map((r) => r.code)));
    const fy1Row = (await db.query(`SELECT * FROM fiscal_years WHERE id=$1`, [fy1.id])).rows[0];
    check('fiscal year row carries the closing entries', Array.isArray(fy1Row.closing_entries) && fy1Row.closing_entries.includes(close.closing_journal_id),
      JSON.stringify(fy1Row.closing_entries));

    /* --- 7. the closed year no longer accepts postings ---------------------------- */
    await rejects(callRpc(db, 'create_journal_entry', {
      p_company_id: companyId, p_date: d1, p_type: 'general',
      p_description: 'بعد الإقفال', p_created_by: userId,
      p_lines: JSON.stringify([{ accountId: A.byCode['1110'], debit: 10, credit: 0 },
                               { accountId: A.byCode['3100'], debit: 0, credit: 10 }]),
    }), 'posting into a closed year is rejected', 'سنة مالية');

    /* --- 8. reopen BEFORE the next year exists: full reversal ---------------------------------- */
    const reopen = (await callRpc(db, 'reopen_fiscal_year_atomic', {
      p_company_id: companyId, p_fiscal_year_id: fy1.id, p_user_id: userId,
    })).rows[0].result;
    check('year reopened (no newer year exists)', reopen.status === 'open', reopen.status);
    check('exactly one closing JE reversed', reopen.reversedClosingEntries === 1, String(reopen.reversedClosingEntries));
    const afterReopen = (await db.query(`
      SELECT a.code, COALESCE(SUM(jl.debit - jl.credit),0) net
      FROM journal_lines jl JOIN journal_entries je ON je.id=jl.journal_entry_id
      JOIN accounts a ON a.id=jl.account_id
      WHERE je.company_id=$1 AND a.code IN ('4100','5400','3200')
      GROUP BY a.code`, [companyId])).rows;
    const arNet = Object.fromEntries(afterReopen.map((r) => [r.code, Number(r.net)]));
    assertBalance(arNet['4100'], -1000, 'year revenue intact after reopen (original JE stays; only the closing is reversed)');
    assertBalance(arNet['5400'], 300, 'year expense intact after reopen (original JE stays)');
    assertBalance(arNet['3200'], 0, 'retained earnings back to zero net after reversal');
    await rejects(callRpc(db, 'reopen_fiscal_year_atomic', {
      p_company_id: companyId, p_fiscal_year_id: fy1.id, p_user_id: userId,
    }), 'reopening an already-open year is rejected', 'غير مقفلة');

    /* --- 9. closing again yields identical figures -------------------------------------------- */
    const close2 = (await callRpc(db, 'close_fiscal_year_atomic', {
      p_company_id: companyId, p_fiscal_year_id: fy1.id, p_user_id: userId,
    })).rows[0].result;
    assertBalance(close2.netIncome, 700, 're-close: netIncome unchanged (reopen JEs filtered)');
    assertBalance(close2.totalRevenue, 1000, 're-close: totalRevenue unchanged');
    const close3 = (await callRpc(db, 'close_fiscal_year_atomic', {
      p_company_id: companyId, p_fiscal_year_id: fy1.id, p_user_id: userId,
    })).rows[0].result;
    check('re-closing a closed year is idempotent', close3.already_processed === true, JSON.stringify(close3).slice(0, 80));

    /* --- 10. the next year — and the effective reopen lockdown --------------------------------- */
    const fy2 = (await callRpc(db, 'create_fiscal_year_atomic', {
      p_company_id: companyId, p_name: 'العام التالي', p_start_date: fy2Range.start,
      p_end_date: fy2Range.end, p_user_id: userId,
    })).rows[0].result;
    check('next year opens once the previous one is closed', fy2.status === 'open', fy2.status);
    const closeFy2 = (await callRpc(db, 'close_fiscal_year_atomic', {
      p_company_id: companyId, p_fiscal_year_id: fy2.id, p_user_id: userId,
    })).rows[0].result;
    check('year with no P&L closes with no closing JE', closeFy2.status === 'closed' && closeFy2.closing_journal_id === null,
      JSON.stringify({ status: closeFy2.status, je: closeFy2.closing_journal_id }));
    // Both closed: the older reopen is blocked by the NEWER closed year…
    await rejects(callRpc(db, 'reopen_fiscal_year_atomic', {
      p_company_id: companyId, p_fiscal_year_id: fy1.id, p_user_id: userId,
    }), 'reopening an older year while a newer one is closed is rejected', 'الأحدث');
    // …the newer one reopens cleanly (nothing to reverse)…
    const reopenFy2 = (await callRpc(db, 'reopen_fiscal_year_atomic', {
      p_company_id: companyId, p_fiscal_year_id: fy2.id, p_user_id: userId,
    })).rows[0].result;
    check('newer year reopens with zero reversals', reopenFy2.status === 'open' && reopenFy2.reversedClosingEntries === 0,
      String(reopenFy2.reversedClosingEntries));
    // …but now the single-open table guard blocks the older reopen as well.
    // PRODUCT NOTE: once a newer year exists (open or closed), the older year can
    // never be reopened — the two guards compose into a permanent lockdown.
    await rejects(callRpc(db, 'reopen_fiscal_year_atomic', {
      p_company_id: companyId, p_fiscal_year_id: fy1.id, p_user_id: userId,
    }), 'reopening the older year with a newer year open is rejected (single-open guard)', 'أكثر من سنة');

    /* --- 11. invariants ------------------------------------------------------------------------ */
    await invDoubleEntry(db, companyId);
    await invTrialBalance(db, companyId);
  }
}
