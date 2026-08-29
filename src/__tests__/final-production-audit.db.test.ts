/**
 * FINAL PRODUCTION AUDIT — live invariants on the real schema.
 *
 * Proves on a genuine PostgreSQL (PGlite + full migration chain) the four
 * invariants an accounting system must never violate:
 *   1. Trial balance: SUM(debit) == SUM(credit) after real postings.
 *   2. Unbalanced / over-precision payloads are REJECTED (never rounded).
 *   3. Cross-tenant actors cannot post into another company's ledger.
 *   4. Closed fiscal years are sealed (trigger + advisory-lock guarded).
 *   5. Journal numbering is unique per company (UNIQUE(company_id, number)).
 *
 * File convention: *.db.test.ts → run via `npm run test:db`.
 */
import { createSchemaContext, type SchemaContext } from './helpers/pglite-schema';

let ctx: SchemaContext;

beforeAll(async () => {
  ctx = await createSchemaContext();
}, 120_000);

afterAll(async () => {
  await ctx?.close();
});

async function accountByCode(code: string): Promise<string> {
  const res = await ctx.query(
    `SELECT id FROM accounts WHERE company_id=$1 AND code=$2 LIMIT 1`,
    [ctx.companyId, code]);
  if (!res.rows.length) throw new Error('missing account ' + code);
  return String(res.rows[0].id);
}

async function postEntry(lines: { code: string; debit?: number; credit?: number }[], opts?: { company?: string; user?: string; date?: string }) {
  const accountIds: Record<string, string> = {};
  for (const l of lines) accountIds[l.code] = await accountByCode(l.code);
  const payload = JSON.stringify(lines.map((l) => ({
    accountId: accountIds[l.code],
    debit: l.debit ?? 0,
    credit: l.credit ?? 0,
    description: 'audit',
  })));
  return ctx.query(
    `SELECT create_journal_entry($1,$2,'general','تدقيق نهائي',$3,$4::jsonb) AS result`,
    [
      opts?.company ?? ctx.companyId,
      opts?.date ?? new Date().toISOString().slice(0, 10),
      opts?.user ?? ctx.userId,
      payload,
    ]);
}

describe('final production audit — accounting invariants (live)', () => {
  test('1. a valid balanced entry posts and the trial balance stays balanced', async () => {
    await postEntry([
      { code: '1110', debit: 1000 },
      { code: '4100', credit: 1000 },
    ]);
    const tb = await ctx.query(
      `SELECT SUM(jl.debit) AS d, SUM(jl.credit) AS c
         FROM journal_lines jl JOIN journal_entries je ON je.id = jl.journal_entry_id
        WHERE je.company_id = $1`, [ctx.companyId]);
    const d = Number(tb.rows[0].d ?? 0);
    const c = Number(tb.rows[0].c ?? 0);
    expect(d).toBeGreaterThan(0);
    expect(Math.abs(d - c)).toBeLessThan(0.005);
  });

  test('2. unbalanced entry is REJECTED with an explicit error', async () => {
    await expect(postEntry([
      { code: '1110', debit: 500 },
      { code: '4100', credit: 400 },
    ])).rejects.toThrow(/الموازنة|balanced/i);
  });

  test('2b. amounts with 3+ decimals are REJECTED (no silent rounding into the ledger)', async () => {
    await expect(postEntry([
      { code: '1110', debit: 10.123 },
      { code: '4100', credit: 10.123 },
    ])).rejects.toThrow(/منزلتين|decimal/i);
  });

  test('3. cross-tenant posting is REJECTED (creator must belong to the company)', async () => {
    // second tenant with its own users table row
    await ctx.query(
      `INSERT INTO companies (id, name) VALUES (gen_random_uuid(), 'شركة أخرى') RETURNING id`,
    ).then(async (r) => {
      const otherCompany = String(r.rows[0].id);
      await expect(postEntry([
        { code: '1110', debit: 10 },
        { code: '4100', credit: 10 },
      ], { company: otherCompany })).rejects.toThrow(/لا ينتمي|company/i);
    });
  });

  test('4. posting into a CLOSED fiscal year is REJECTED', async () => {
    // setup_initial_company already created the fiscal year covering today —
    // seal it instead of inserting an overlapping one.
    await ctx.query(
      `UPDATE fiscal_years SET status='closed'
        WHERE company_id=$1 AND CURRENT_DATE BETWEEN start_date AND end_date`,
      [ctx.companyId]);
    await expect(postEntry([
      { code: '1110', debit: 10 },
      { code: '4100', credit: 10 },
    ])).rejects.toThrow(/closed fiscal|مقفلة/i);
    // restore for any later checks
    await ctx.query(
      `UPDATE fiscal_years SET status='open'
        WHERE company_id=$1 AND CURRENT_DATE BETWEEN start_date AND end_date`,
      [ctx.companyId]);
  });

  test('5. journal numbering is unique per company (UNIQUE constraint holds)', async () => {
    const dup = await ctx.query(
      `SELECT COUNT(*) AS n FROM journal_entries WHERE company_id=$1`,
      [ctx.companyId]);
    expect(Number(dup.rows[0].n)).toBeGreaterThanOrEqual(1);
    // Attempt a direct duplicate-number insert; the UNIQUE index must fire.
    const existing = await ctx.query(
      `SELECT number, date, type, created_by FROM journal_entries WHERE company_id=$1 LIMIT 1`,
      [ctx.companyId]);
    const e = existing.rows[0] as Record<string, unknown>;
    await expect(ctx.query(
      `INSERT INTO journal_entries (company_id, number, date, type, created_by)
       VALUES ($1, $2, $3, $4, $5)`,
      [ctx.companyId, e.number, e.date, 'general', e.created_by],
    )).rejects.toThrow(/duplicate|unique/i);
  });
});
