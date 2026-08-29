/**
 * Regression test for migration 118: petty-cash opening balance funding.
 *
 * Before 118, create_petty_cash_box() funded a positive opening balance from
 * account 3000 (حقوق الملكية), which is a non-posting header. The function's
 * own COALESCE(is_header,FALSE)=FALSE guard then left the funding account NULL
 * and raised 'حساب تمويل الرصيد الافتتاحي غير صالح' — so no box with an opening
 * balance could ever be created without an explicit funding account.
 *
 * After 118 the fallback is 3100 (رأس المال), a real posting equity account.
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

describe('create_petty_cash_box — opening-balance funding account', () => {
  test('mirror production: 3000 is a header, 3100 is the posting equity account', async () => {
    // Mark 3000 as a header exactly like the default chart of accounts does.
    await ctx.query(
      `UPDATE accounts SET is_header=TRUE WHERE company_id=$1 AND code='3000'`,
      [ctx.companyId]);

    const header = await ctx.query(
      `SELECT is_header FROM accounts WHERE company_id=$1 AND code='3000'`,
      [ctx.companyId]);
    expect(header.rows[0]?.is_header).toBe(true);

    const capital = await ctx.query(
      `SELECT is_header FROM accounts WHERE company_id=$1 AND code='3100'`,
      [ctx.companyId]);
    expect(capital.rows[0]?.is_header).toBe(false);
  });

  test('a box with an opening balance and no funding account posts against 3100', async () => {
    await ctx.query(
      `UPDATE accounts SET is_header=TRUE WHERE company_id=$1 AND code='3000'`,
      [ctx.companyId]);

    const res = await ctx.query(
      `SELECT create_petty_cash_box(
         $1, $2, $3, $4, $5, $6, $7, $8, $9, $10
       ) AS box`,
      [
        ctx.companyId,
        'صندوق مصروفات نثرية',
        500,
        1000,
        'SAR',
        null, // custodian
        'اختبار',
        null, // account_id → falls back to 1110
        null, // funding_account_id → must fall back to 3100
        ctx.userId,
      ]);

    const box = res.rows[0]?.box as { id: string; opening_journal_entry_id?: string };
    expect(box).toBeTruthy();
    expect(box.id).toBeTruthy();

    const jid = box.opening_journal_entry_id;
    expect(jid).toBeTruthy();

    // The opening entry must debit the box account (1110) and credit 3100.
    const capital = await accountByCode('3100');
    const cash = await accountByCode('1110');

    const lines = await ctx.query(
      `SELECT account_id, debit, credit
         FROM journal_lines
        WHERE journal_entry_id=$1
        ORDER BY debit DESC`,
      [jid]);

    expect(lines.rows).toHaveLength(2);
    const byAccount = new Map(lines.rows.map((r) => [r.account_id, r]));

    const cashLine = byAccount.get(cash);
    expect(Number(cashLine?.debit)).toBe(500);
    expect(Number(cashLine?.credit)).toBe(0);

    const capitalLine = byAccount.get(capital);
    expect(Number(capitalLine?.debit)).toBe(0);
    expect(Number(capitalLine?.credit)).toBe(500);
  });

  test('an explicit funding account is still honoured when provided', async () => {
    // Use 3200 (retained earnings) as an explicit funding account.
    const funding = await accountByCode('3200');
    const res = await ctx.query(
      `SELECT create_petty_cash_box(
         $1, $2, $3, $4, $5, $6, $7, $8, $9, $10
       ) AS box`,
      [
        ctx.companyId,
        'صندوق ثانٍ',
        250,
        1000,
        'SAR',
        null,
        'اختبار',
        null,
        funding,
        ctx.userId,
      ]);
    const box = res.rows[0]?.box as { id: string; opening_journal_entry_id?: string };
    expect(box.id).toBeTruthy();

    const lines = await ctx.query(
      `SELECT account_id, credit
         FROM journal_lines
        WHERE journal_entry_id=$1 AND credit>0`,
      [box.opening_journal_entry_id]);
    expect(lines.rows).toHaveLength(1);
    expect(lines.rows[0]?.account_id).toBe(funding);
  });
});
