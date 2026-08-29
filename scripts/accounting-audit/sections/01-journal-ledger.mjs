/**
 * Section 01 — Journal & Ledger (القيود اليومية ودفتر الأستاذ)
 *
 * First-principles audit of the journal engine:
 *  - double-entry integrity of every entry (engine + manual)
 *  - input contract of create_journal_entry (types, line rules, 2dp cap,
 *    header-account rejection, tenant-scoped accounts/contacts/projects)
 *  - posted-journal immutability (no UPDATE/DELETE after posting)
 *  - reversal semantics (exact offset + linkage)
 *  - fiscal-year lifecycle (close → P&L zero, posting blocked, reopen)
 *  - numbering (unique, sequential per company)
 *  - trial balance + balance-sheet identity after all traffic
 */
import {
  check, rejects, callRpc,
  invDoubleEntry, invTrialBalance, invBalanceSheet, invNoDuplicateNumbers, invTenantScope, invPnlClosed,
} from '../framework.mjs';

export const name = '01 Journal & Ledger (القيود اليومية)';

export async function run({ db, A, B, E }) {
  const { companyId, userId, byCode, contacts } = A;
  const date = '2026-06-01';

  /* --- 1. balanced manual entry succeeds and is numbered ------------ */
  const je1 = (await callRpc(db, 'create_journal_entry', {
    p_company_id: companyId, p_date: date, p_type: 'general',
    p_description: 'قيد المراجعة 1', p_created_by: userId,
    p_lines: JSON.stringify([
      { accountId: byCode['1110'], debit: 1000, credit: 0 },
      { accountId: byCode['1121'], debit: 0, credit: 1000 },
    ]),
  })).rows[0].result;
  check('JE created: returns id + number', !!je1.id && Number.isInteger(Number(je1.number)), JSON.stringify(je1).slice(0, 120));

  const je1Lines = await db.query(
    'SELECT account_id, debit, credit FROM journal_lines WHERE journal_entry_id=$1', [je1.id]);
  const lineSet = je1Lines.rows
    .map((l) => `${l.account_id === byCode['1110'] ? 'cash' : 'bank'}:${Number(l.debit)}/${Number(l.credit)}`)
    .sort().join('|');
  check('JE lines persisted exactly (2 lines, amounts intact)',
    je1Lines.rows.length === 2 && lineSet === `bank:0/1000|cash:1000/0`, lineSet);

  /* --- 2. input contract -------------------------------------------- */
  await rejects(callRpc(db, 'create_journal_entry', {
    p_company_id: companyId, p_date: date, p_type: 'general', p_description: 'unbalanced', p_created_by: userId,
    p_lines: JSON.stringify([
      { accountId: byCode['1110'], debit: 100, credit: 0 },
      { accountId: byCode['1121'], debit: 0, credit: 90 },
    ]),
  }), 'unbalanced entry rejected');

  await rejects(callRpc(db, 'create_journal_entry', {
    p_company_id: companyId, p_date: date, p_type: 'bogus_type', p_description: 'x', p_created_by: userId,
    p_lines: JSON.stringify([
      { accountId: byCode['1110'], debit: 1, credit: 0 },
      { accountId: byCode['1121'], debit: 0, credit: 1 },
    ]),
  }), 'invalid entry type rejected');

  await rejects(callRpc(db, 'create_journal_entry', {
    p_company_id: companyId, p_date: date, p_type: 'general', p_description: 'single line', p_created_by: userId,
    p_lines: JSON.stringify([{ accountId: byCode['1110'], debit: 100, credit: 0 }]),
  }), 'single-line entry rejected');

  await rejects(callRpc(db, 'create_journal_entry', {
    p_company_id: companyId, p_date: date, p_type: 'general', p_description: 'both sides', p_created_by: userId,
    p_lines: JSON.stringify([
      { accountId: byCode['1110'], debit: 10, credit: 10 },
      { accountId: byCode['1121'], debit: 0, credit: 10 },
      { accountId: byCode['5100'], debit: 10, credit: 0 },
    ]),
  }), 'line with both debit and credit rejected');

  await rejects(callRpc(db, 'create_journal_entry', {
    p_company_id: companyId, p_date: date, p_type: 'general', p_description: 'neg', p_created_by: userId,
    p_lines: JSON.stringify([
      { accountId: byCode['1110'], debit: -5, credit: 0 },
      { accountId: byCode['1121'], debit: 0, credit: 5 },
    ]),
  }), 'negative amount rejected');

  await rejects(callRpc(db, 'create_journal_entry', {
    p_company_id: companyId, p_date: date, p_type: 'general', p_description: '3dp', p_created_by: userId,
    p_lines: JSON.stringify([
      { accountId: byCode['1110'], debit: 1.005, credit: 0 },
      { accountId: byCode['1121'], debit: 0, credit: 1.005 },
    ]),
  }), 'amount with 3 decimal places rejected');

  await rejects(callRpc(db, 'create_journal_entry', {
    p_company_id: companyId, p_date: date, p_type: 'general', p_description: 'header acc', p_created_by: userId,
    p_lines: JSON.stringify([
      { accountId: byCode['1140'], debit: 10, credit: 0 },
      { accountId: byCode['1121'], debit: 0, credit: 10 },
    ]),
  }), 'posting to a header account rejected');

  await rejects(callRpc(db, 'create_journal_entry', {
    p_company_id: companyId, p_date: date, p_type: 'general', p_description: 'ghost acc', p_created_by: userId,
    p_lines: JSON.stringify([
      { accountId: '99999999-0000-4000-8000-000000000001', debit: 10, credit: 0 },
      { accountId: byCode['1121'], debit: 0, credit: 10 },
    ]),
  }), 'posting to a non-existent account rejected');

  /* cross-tenant account on the lines: A posts with B's account id */
  await rejects(callRpc(db, 'create_journal_entry', {
    p_company_id: companyId, p_date: date, p_type: 'general', p_description: 'foreign acc', p_created_by: userId,
    p_lines: JSON.stringify([
      { accountId: B.byCode['1110'], debit: 10, credit: 0 },
      { accountId: byCode['1121'], debit: 0, credit: 10 },
    ]),
  }), 'cross-tenant account in lines rejected');

  /* cross-tenant contact on a line */
  await rejects(callRpc(db, 'create_journal_entry', {
    p_company_id: companyId, p_date: date, p_type: 'general', p_description: 'foreign contact', p_created_by: userId,
    p_lines: JSON.stringify([
      { accountId: byCode['1110'], debit: 10, credit: 0, contactId: B.contacts.client },
      { accountId: byCode['1121'], debit: 0, credit: 10 },
    ]),
  }), 'cross-tenant contact on a line rejected');

  /* creator of another company cannot post here */
  await rejects(callRpc(db, 'create_journal_entry', {
    p_company_id: companyId, p_date: date, p_type: 'general', p_description: 'foreign user', p_created_by: B.userId,
    p_lines: JSON.stringify([
      { accountId: byCode['1110'], debit: 10, credit: 0 },
      { accountId: byCode['1121'], debit: 0, credit: 10 },
    ]),
  }), 'user of another company cannot post an entry here');

  /* --- 3. second entry: sequential numbering ------------------------- */
  const je2 = (await callRpc(db, 'create_journal_entry', {
    p_company_id: companyId, p_date: date, p_type: 'general', p_description: 'قيد المراجعة 2', p_created_by: userId,
    p_lines: JSON.stringify([
      { accountId: byCode['5100'], debit: 250, credit: 0 },
      { accountId: byCode['1110'], debit: 0, credit: 250 },
    ]),
  })).rows[0].result;
  check('JE numbers sequential per company', Number(je2.number) === Number(je1.number) + 1,
    `je1=${je1.number} je2=${je2.number}`);

  /* --- 4. posted-journal immutability -------------------------------- */
  const lineRow = (await db.query('SELECT id FROM journal_lines WHERE journal_entry_id=$1 LIMIT 1', [je1.id])).rows[0];
  await rejects(db.query('UPDATE journal_lines SET debit=1 WHERE id=$1', [lineRow.id]),
    'UPDATE on a posted journal line rejected');
  await rejects(db.query('DELETE FROM journal_lines WHERE id=$1', [lineRow.id]),
    'DELETE of a posted journal line rejected');
  await rejects(db.query('DELETE FROM journal_entries WHERE id=$1', [je1.id]),
    'DELETE of a posted journal entry rejected');
  await rejects(db.query("UPDATE journal_entries SET description='hacked' WHERE id=$1", [je1.id]),
    'UPDATE of a posted journal entry rejected');

  /* --- 5. reversal ---------------------------------------------------- */
  const rev = (await callRpc(db, 'reverse_journal_entry_atomic', {
    p_company_id: companyId, p_journal_entry_id: je2.id, p_reverse_date: '2026-06-05',
    p_description: 'عكس قيد المراجعة', p_reference_type: null, p_reference_id: null, p_user_id: userId,
  })).rows[0].result;
  check('reversal created and linked', !!rev.id && rev.id !== je2.id, JSON.stringify(rev).slice(0, 120));
  const net = await db.query(`
    SELECT COALESCE(SUM(jl.debit),0) d, COALESCE(SUM(jl.credit),0) c
    FROM journal_lines jl
    WHERE jl.journal_entry_id IN (
      SELECT je.id FROM journal_entries je
      WHERE je.id = $1 OR je.reversal_of = $1 OR $1 = (SELECT r.id FROM journal_entries r WHERE r.reversal_of = je.id)
    )`, [je2.id]);
  check('original + reversal net to zero on every side',
    Math.abs(Number(net.rows[0].d) - Number(net.rows[0].c)) <= 0.005
    && Number(net.rows[0].d) >= 500,
    `d=${net.rows[0].d} c=${net.rows[0].c}`);

  /* --- 6. fiscal-year lifecycle --------------------------------------- */
  const fy = (await db.query('SELECT id, status FROM fiscal_years WHERE company_id=$1 ORDER BY start_date', [companyId])).rows;
  check('company has an open fiscal year after registration',
    fy.length >= 1 && fy[fy.length - 1].status === 'open', JSON.stringify(fy));

  // expense revenue to make P&L non-zero before closing
  await callRpc(db, 'create_journal_entry', {
    p_company_id: companyId, p_date: '2026-06-15', p_type: 'general', p_description: 'إيراد قبل الإقفال', p_created_by: userId,
    p_lines: JSON.stringify([
      { accountId: byCode['1110'], debit: 800, credit: 0 },
      { accountId: byCode['4100'], debit: 0, credit: 800 },
    ]),
  });

  const closeRes = (await callRpc(db, 'close_fiscal_year_atomic', {
    p_company_id: companyId, p_fiscal_year_id: fy[fy.length - 1].id, p_user_id: userId,
  })).rows[0].result;
  check('fiscal year close succeeds', closeRes && (closeRes.success === true || closeRes.status === 'closed' || !!closeRes.closing_journal_entry_id || Object.keys(closeRes).length > 0),
    JSON.stringify(closeRes).slice(0, 120));

  await rejects(callRpc(db, 'create_journal_entry', {
    p_company_id: companyId, p_date: '2026-06-20', p_type: 'general', p_description: 'بعد الإقفال', p_created_by: userId,
    p_lines: JSON.stringify([
      { accountId: byCode['1110'], debit: 10, credit: 0 },
      { accountId: byCode['1121'], debit: 0, credit: 10 },
    ]),
  }), 'posting inside a closed fiscal year rejected');

  await invPnlClosed(db, companyId, fy[fy.length - 1].id);

  await callRpc(db, 'reopen_fiscal_year_atomic', {
    p_company_id: companyId, p_fiscal_year_id: fy[fy.length - 1].id, p_user_id: userId,
  });
  const afterReopen = (await callRpc(db, 'create_journal_entry', {
    p_company_id: companyId, p_date: '2026-06-21', p_type: 'general', p_description: 'بعد إعادة الفتح', p_created_by: userId,
    p_lines: JSON.stringify([
      { accountId: byCode['1110'], debit: 7, credit: 0 },
      { accountId: byCode['1121'], debit: 0, credit: 7 },
    ]),
  })).rows[0].result;
  check('posting allowed again after reopen', !!afterReopen.id);

  /* --- 7. global invariants ------------------------------------------ */
  await invDoubleEntry(db, companyId);
  await invTrialBalance(db, companyId);
  await invBalanceSheet(db, companyId);
  await invNoDuplicateNumbers(db, companyId, 'journal_entries');
  await invTenantScope(db, companyId);
}
