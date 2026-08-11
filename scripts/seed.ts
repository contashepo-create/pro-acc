/**
 * Seed script for load / performance / integration testing.
 *
 * Creates a dedicated demo tenant and populates it with a chart of accounts,
 * customers, and a configurable number of balanced invoices + journal entries.
 * Safe to run repeatedly: it upserts the company, creates accounts only once,
 * and appends invoices (numbers keep incrementing) so the dataset can grow.
 *
 * Usage:  npx tsx scripts/seed.ts
 * Env:    DATABASE_URL (required), DATABASE_CA_CERT (optional), SEED_INVOICES (default 500)
 */
import { Pool } from 'pg';
import { randomUUID } from 'crypto';

const COMPANY_ID = '11111111-1111-1111-1111-111111111111';
const COMPANY_NAME = 'LoadTest Tenant';
const SEED_INVOICES = parseInt(process.env.SEED_INVOICES || '500', 10);

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: process.env.DATABASE_CA_CERT
    ? { rejectUnauthorized: true, ca: process.env.DATABASE_CA_CERT }
    : undefined,
});

const ACCOUNTS: Array<{ code: string; name: string; type: string }> = [
  { code: '1110', name: 'Cash', type: 'asset' },
  { code: '1120', name: 'Banks', type: 'asset' },
  { code: '1130', name: 'Accounts Receivable', type: 'asset' },
  { code: '2120', name: 'VAT Payable (Sales)', type: 'liability' },
  { code: '4100', name: 'Contract Revenue', type: 'revenue' },
  { code: '5100', name: 'Direct Costs', type: 'expense' },
];

async function nextNumber(table: string, column: string): Promise<number> {
  const { rows } = await pool.query(
    `SELECT COALESCE(MAX(${column}), 0) + 1 AS n FROM ${table} WHERE company_id = $1`,
    [COMPANY_ID]
  );
  return Number(rows[0].n);
}

async function main() {
  // 1) Company (upsert)
  await pool.query(
    `INSERT INTO companies (id, name, is_active, created_at)
     VALUES ($1, $2, true, NOW())
     ON CONFLICT (id) DO NOTHING`,
    [COMPANY_ID, COMPANY_NAME]
  );

  // 2) Accounts (insert once)
  const { rows: existing } = await pool.query(
    'SELECT 1 FROM accounts WHERE company_id = $1 LIMIT 1',
    [COMPANY_ID]
  );
  if (existing.length === 0) {
    for (const a of ACCOUNTS) {
      await pool.query(
        `INSERT INTO accounts (id, company_id, code, name, type, is_active, created_at)
         VALUES ($1, $2, $3, $4, $5, true, NOW())`,
        [randomUUID(), COMPANY_ID, a.code, a.name, a.type]
      );
    }
  }
  const acct = await pool.query(
    'SELECT id, code FROM accounts WHERE company_id = $1',
    [COMPANY_ID]
  );
  const byCode = Object.fromEntries(acct.rows.map((r: any) => [r.code, r.id]));

  // 3) Invoices + balanced journal entries
  let invNo = await nextNumber('invoices', 'number');
  let jeNo = await nextNumber('journal_entries', 'number');
  for (let i = 0; i < SEED_INVOICES; i++) {
    const cid = randomUUID();
    await pool.query(
      `INSERT INTO contacts (id, company_id, name, contact_type, created_at)
       VALUES ($1, $2, $3, 'customer', NOW())`,
      [cid, COMPANY_ID, `Cust-${i}`]
    );

    const qty = 1 + (i % 5);
    const price = 100 + (i % 9) * 100;
    const subtotal = qty * price;
    const vat = Number((subtotal * 0.15).toFixed(2));
    const total = Number((subtotal + vat).toFixed(2));
    const invId = randomUUID();
    await pool.query(
      `INSERT INTO invoices (id, company_id, number, contact_id, date, due_date, subtotal, vat_rate, vat_amount, total, status, created_at)
       VALUES ($1,$2,$3,$4,NOW(),NOW()+$5::int*INTERVAL '1 day',$6,$7,$8,$9,'approved',NOW())`,
      [invId, COMPANY_ID, invNo, cid, 30, subtotal, 0.15, vat, total]
    );
    await pool.query(
      `INSERT INTO invoice_items (id, company_id, invoice_id, description, quantity, unit_price, total, created_at)
       VALUES ($1,$2,$3,$4,$5,$6,$7,NOW())`,
      [randomUUID(), COMPANY_ID, invId, 'Service', qty, price, subtotal]
    );

    const jeId = randomUUID();
    await pool.query(
      `INSERT INTO journal_entries (id, company_id, number, date, type, description, created_at)
       VALUES ($1,$2,$3,NOW(),'general',$4,NOW())`,
      [jeId, COMPANY_ID, jeNo, `Seed invoice ${invNo}`]
    );
    // Balanced: AR = total (dr); Revenue = subtotal (cr); VAT = vat (cr)
    await pool.query(
      `INSERT INTO journal_lines (id, company_id, journal_entry_id, account_id, account_code, account_name, debit, credit, created_at)
       VALUES
        ($1, $2, $3, $4, '1130', 'Accounts Receivable', $5, 0, NOW()),
        ($6, $7, $8, $9, '4100', 'Contract Revenue', 0, $10, NOW()),
        ($11, $12, $13, $14, '2120', 'VAT Payable', 0, $15, NOW())`,
      [
        randomUUID(), COMPANY_ID, jeId, byCode['1130'], total,
        randomUUID(), COMPANY_ID, jeId, byCode['4100'], subtotal,
        randomUUID(), COMPANY_ID, jeId, byCode['2120'], vat,
      ]
    );
    invNo++;
    jeNo++;
  }

  const { rows: counts } = await pool.query(
    `SELECT
       (SELECT COUNT(*) FROM invoices WHERE company_id=$1) AS invoices,
       (SELECT COUNT(*) FROM journal_entries WHERE company_id=$1) AS entries,
       (SELECT COUNT(*) FROM journal_lines WHERE journal_entry_id IN (SELECT id FROM journal_entries WHERE company_id=$1)) AS lines`,
    [COMPANY_ID]
  );
  console.log('Seeded LoadTest tenant', COMPANY_ID, counts[0]);
  await pool.end();
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
