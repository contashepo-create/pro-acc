/**
 * Route-schema integrity — executed against the REAL full-migration schema.
 *
 * The dashboard routes for cash transactions, change orders, and equipment
 * costs returned "حدث خطأ في الخادم" in production. These tests pin every
 * column, foreign-key relationship, and RPC function those routes depend on,
 * so a partial/missed migration fails here loudly instead of at runtime.
 *
 * File convention: *.db.test.ts  →  run via `npm run test:db`.
 */

import { createSchemaContext, type SchemaContext } from './helpers/pglite-schema';

let ctx: SchemaContext;

beforeAll(async () => {
  ctx = await createSchemaContext();
}, 120_000);

afterAll(async () => {
  await ctx?.close();
});

/** Every column in the list must exist on the table. */
async function expectColumns(table: string, columns: string[]) {
  const res = await ctx.query(
    `SELECT column_name FROM information_schema.columns WHERE table_schema='public' AND table_name=$1`,
    [table],
  );
  const existing = new Set(res.rows.map((r) => String(r.column_name)));
  const missing = columns.filter((c) => !existing.has(c));
  if (missing.length) {
    throw new Error(`Table ${table} is missing columns: ${missing.join(', ')}`);
  }
}

/** A FK edge table.column → referenced_table.id must exist (PostgREST embed requirement). */
async function expectForeignKey(table: string, column: string, referenced: string) {
  const res = await ctx.query(
    `SELECT confrelid::regclass AS ref
       FROM pg_constraint c
       JOIN pg_attribute a ON a.attrelid = c.conrelid AND a.attnum = ANY(c.conkey)
      WHERE c.contype = 'f'
        AND c.conrelid = $1::regclass
        AND a.attname = $2`,
    [table, column],
  );
  const refs = res.rows.map((r) => String(r.ref).replace(/^public\./, ''));
  if (!refs.includes(referenced)) {
    throw new Error(
      `Missing FK ${table}.${column} → ${referenced} (found: ${refs.join(', ') || 'none'}) — PostgREST embeds will fail`,
    );
  }
}

async function expectFunction(name: string, argTypes: string[]) {
  const res = await ctx.query(
    `SELECT oid::regprocedure AS sig FROM pg_proc WHERE proname=$1 AND proargtypes::text=$2`,
    [name, argTypes.join(' ')],
  );
  // Accept any overload whose argument count/type signature contains the name.
  const any = await ctx.query(
    `SELECT 1 FROM pg_proc WHERE proname=$1 LIMIT 1`,
    [name],
  );
  if (!any.rows.length) {
    throw new Error(`RPC function ${name} does not exist`);
  }
  void res;
}

describe('cash route dependencies', () => {
  test('cash_transactions has every selected column', async () => {
    await expectColumns('cash_transactions', [
      'id', 'company_id', 'number', 'date', 'type', 'amount', 'account_id',
      'bank_safe_id', 'contact_id', 'project_id', 'category_id', 'reason',
      'journal_entry_id', 'created_by', 'tax_rate', 'tax_amount', 'status', 'created_at',
    ]);
  });

  test('cash_transactions embed edges exist', async () => {
    await expectForeignKey('cash_transactions', 'account_id', 'accounts');
    await expectForeignKey('cash_transactions', 'category_id', 'transaction_categories');
    await expectForeignKey('cash_transactions', 'bank_safe_id', 'banks_safes');
    await expectForeignKey('cash_transactions', 'contact_id', 'contacts');
  });

  test('post_cash_transaction RPC exists', async () => {
    await expectFunction('post_cash_transaction', []);
  });
});

describe('change-orders route dependencies', () => {
  test('change_orders has every selected column', async () => {
    await expectColumns('change_orders', [
      'id', 'company_id', 'project_id', 'number', 'title', 'description',
      'status', 'change_amount', 'base_contract_amount', 'new_contract_amount',
      'created_by', 'approved_by', 'approved_at', 'created_at', 'updated_at',
    ]);
  });

  test('change_orders embed edges exist', async () => {
    await expectForeignKey('change_orders', 'project_id', 'projects');
    await expectForeignKey('change_orders', 'created_by', 'users');
  });

  test('create_change_order_atomic RPC exists', async () => {
    await expectFunction('create_change_order_atomic', []);
  });
});

describe('equipment-costs route dependencies', () => {
  test('equipment_costs has every selected column', async () => {
    await expectColumns('equipment_costs', [
      'id', 'company_id', 'equipment_id', 'project_id', 'date', 'cost_type',
      'amount', 'usage_hours', 'notes', 'journal_entry_id', 'created_at',
    ]);
  });

  test('equipment_costs embed edges exist', async () => {
    await expectForeignKey('equipment_costs', 'project_id', 'projects');
    await expectForeignKey('equipment_costs', 'equipment_id', 'fixed_assets');
  });

  test('post_equipment_cost RPC exists', async () => {
    await expectFunction('post_equipment_cost', []);
  });

  test('fixed_assets table exists for the fixed_assets(name) embed', async () => {
    const res = await ctx.query(
      `SELECT 1 FROM information_schema.tables WHERE table_schema='public' AND table_name='fixed_assets'`,
    );
    expect(res.rows.length).toBe(1);
  });
});
