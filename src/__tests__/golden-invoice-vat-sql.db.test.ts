/**
 * Golden VAT tests — executed against the REAL create_sales_invoice_atomic()
 * SQL function running inside a full PGlite schema.
 *
 * These are the same kind of "hand-verified, calculator-checked" fixtures that
 * protect against the exact bug class the project already encountered: wrong
 * VAT column/field mapping that silently zeroes out tax. They run against the
 * actual Postgres function, not a JS approximation.
 *
 * File convention: *.db.test.ts  →  excluded from the default `npm test`
 * (which can't load PGlite's dynamic import()) and run separately via
 * `npm run test:db` with --experimental-vm-modules.
 */

import { createSchemaContext, type SchemaContext } from './helpers/pglite-schema';

let ctx: SchemaContext;
let contactId: string;

beforeAll(async () => {
  ctx = await createSchemaContext();

  // Create a contact (client) for the test invoices.
  const contact = await ctx.query(
    `INSERT INTO contacts(company_id, name, type, is_active)
     VALUES($1, 'عميل تجريبي', 'client', TRUE)
     RETURNING id`,
    [ctx.companyId],
  );
  contactId = contact.rows[0].id;
}, 120_000); // migrations can take a while under PGlite

afterAll(async () => {
  await ctx?.close();
});

/* ── helpers ── */
function makeItems(lines: Array<{ description: string; quantity: number; unitPrice: number; discount?: number }>) {
  return JSON.stringify(
    lines.map((l) => ({
      description: l.description,
      quantity: l.quantity,
      unitPrice: l.unitPrice,
      discount: l.discount ?? 0,
    })),
  );
}

async function createInvoice(
  vatRate: number,
  vatEnabled: boolean,
  items: string,
  date = '2026-01-15',
  dueDate = '2026-02-15',
) {
  const result = await ctx.query(
    `SELECT create_sales_invoice_atomic(
       $1::UUID, $2::UUID, NULL::UUID, $3::DATE, $4::DATE,
       $5::JSONB, $6::NUMERIC, $7::BOOLEAN, ''::TEXT,
       0::NUMERIC, NULL::UUID, $8::UUID
     ) AS inv`,
    [ctx.companyId, contactId, date, dueDate, items, vatRate, vatEnabled, ctx.userId],
  );
  return result.rows[0].inv;
}

/* ── golden cases (all numbers hand-verified with a calculator) ── */

describe('Golden invoice VAT — SQL level', () => {
  test('Case 1: standard 15 % VAT, single line', async () => {
    // 10 × 100 = 1000.00 subtotal → 1000 × 0.15 = 150.00 VAT → total 1150.00
    const inv = await createInvoice(
      0.15,
      true,
      makeItems([{ description: 'خدمة استشارية', quantity: 10, unitPrice: 100 }]),
    );
    expect(Number(inv.subtotal)).toBe(1000);
    expect(Number(inv.vat_amount)).toBe(150);
    expect(Number(inv.total)).toBe(1150);
  });

  test('Case 2: zero-rated VAT (vat_enabled=true, rate=0)', async () => {
    // 5 × 200 = 1000.00 → 0% → total 1000.00
    const inv = await createInvoice(
      0,
      true,
      makeItems([{ description: 'سلعة معفاة', quantity: 5, unitPrice: 200 }]),
    );
    expect(Number(inv.subtotal)).toBe(1000);
    expect(Number(inv.vat_amount)).toBe(0);
    expect(Number(inv.total)).toBe(1000);
  });

  test('Case 3: VAT disabled entirely', async () => {
    const inv = await createInvoice(
      0.15,
      false,
      makeItems([{ description: 'منتج', quantity: 1, unitPrice: 500 }]),
    );
    expect(Number(inv.subtotal)).toBe(500);
    expect(Number(inv.vat_amount)).toBe(0);
    expect(Number(inv.total)).toBe(500);
  });

  test('Case 4: rounding — 999.99 × 15 % = 149.9985 → must round to 150.00', async () => {
    // This is THE classic rounding-edge case. If the function truncates instead
    // of rounding, you get 149.99 (wrong). The SQL uses round(…, 2) which
    // performs "round half up" (banker's), producing 150.00.
    const inv = await createInvoice(
      0.15,
      true,
      makeItems([{ description: 'خدمة', quantity: 1, unitPrice: 999.99 }]),
    );
    expect(Number(inv.subtotal)).toBe(999.99);
    expect(Number(inv.vat_amount)).toBe(150);      // 149.9985 rounded → 150.00
    expect(Number(inv.total)).toBe(1149.99);        // 999.99 + 150.00
  });

  test('Case 5: line with discount, 15 % VAT', async () => {
    // qty=3, price=100, discount=50 → gross=300, net=250
    // VAT = 250 × 0.15 = 37.50 → total = 287.50
    const inv = await createInvoice(
      0.15,
      true,
      makeItems([{ description: 'سلعة مخفضة', quantity: 3, unitPrice: 100, discount: 50 }]),
    );
    expect(Number(inv.subtotal)).toBe(250);
    expect(Number(inv.vat_amount)).toBe(37.5);
    expect(Number(inv.total)).toBe(287.5);
  });

  test('Journal entry is balanced (debit = credit) for every golden invoice', async () => {
    // Fetch all journal entries created above and assert balance.
    const { rows } = await ctx.query(
      `SELECT je.id,
              SUM(jel.debit)  AS total_debit,
              SUM(jel.credit) AS total_credit
       FROM journal_entries je
       JOIN journal_lines jel ON jel.journal_entry_id = je.id
       WHERE je.company_id = $1
       GROUP BY je.id`,
      [ctx.companyId],
    );
    expect(rows.length).toBeGreaterThanOrEqual(4); // at least 4 invoices above had total > 0
    for (const row of rows) {
      expect(Number(row.total_debit)).toBe(Number(row.total_credit));
    }
  });
});
