/**
 * Section 2 tests — Initial setup & Chart of Accounts
 *
 * Covers:
 * 1. Integrity of the default Saudi chart of accounts (single source of truth)
 * 2. createDefaultChartOfAccounts behaviour (idempotency, tenant scoping,
 *    parent linking) with a chainable Supabase mock
 * 3. Account API routes: POST create (validation, cross-tenant parent,
 *    duplicate code), PUT update (schema-only fields, no type/parent
 *    tampering), DELETE (journal/bank/fixed-asset protection, tenant
 *    isolation)
 */

process.env.TOKEN_SECRET = 'test-secret-key-for-unit-tests-32chars!';

// The DB-backed share of the per-user rate limit is out of scope for these
// suites (the memory fast path is what they exercise); the authoritative
// store is covered by shared-rate-limit.test.ts + the 077 migration smoke.
jest.mock('@/lib/shared-rate-limit', () => ({ hitSharedRateLimit: async () => ({ allowed: true, retryAfterSeconds: 0 }) }));
import { DEFAULT_CHART_OF_ACCOUNTS, createDefaultChartOfAccounts } from '@/lib/default-accounts';
import { createToken } from '@/lib/auth';
import type { TestBuilder } from './mocks';
import type { NextRequest } from 'next/server';
import type { SupabaseLike } from '@/lib/types';

// ---------------------------------------------------------------------------
// Chainable Supabase mock
// ---------------------------------------------------------------------------

type Row = Record<string, unknown>;
type Op = { op: string; col?: string; val?: unknown };

function makeDb(db: Record<string, Row[]>) {
  const calls: Array<{ table: string; ops: Op[]; mut: { kind?: string; payload?: Row } }> = [];
  let insertCounter = 0;

  const from = (table: string) => {
    const ops: Op[] = [];
    const mut: { kind?: string; payload?: Row } = {};
    const call = { table, ops, mut };
    calls.push(call);

    const rows = () => (db[table] || []);
    const applyFilters = () =>
      rows().filter((r) =>
        ops.every((o) => {
          if (o.op === 'eq') return r[o.col!] === o.val;
          if (o.op === 'neq') return r[o.col!] !== o.val;
          if (o.op === 'in') return (o.val as unknown[]).includes(r[o.col!]);
          return true;
        })
      );

    const api: TestBuilder = {
      select: () => api,
      eq: (col: string, val: unknown) => { ops.push({ op: 'eq', col, val }); return api; },
      neq: (col: string, val: unknown) => { ops.push({ op: 'neq', col, val }); return api; },
      in: (col: string, val: unknown) => { ops.push({ op: 'in', col, val }); return api; },
      or: () => api,
      gte: () => api,
      order: () => api,
      limit: () => api,
      insert: (payload: Row) => { mut.kind = 'insert'; mut.payload = payload; return api; },
      update: (payload: Row) => { mut.kind = 'update'; mut.payload = payload; return api; },
      delete: () => { mut.kind = 'delete'; return api; },
      maybeSingle: async () => ({ data: applyFilters()[0] ?? null, error: null }),
      single: async () => {
        if (mut.kind === 'insert') {
          const payload = mut.payload as Row;
          payload.id = payload.id ?? `id-${++insertCounter}`;
          (db[table] = db[table] || []).push(payload);
          return { data: payload, error: null };
        }
        const row = applyFilters()[0] ?? null;
        return { data: row, error: row ? null : { message: 'not found' } };
      },
      then: <T1 = { data: unknown; error: unknown }, T2 = never>(
        onF?: ((v: { data: unknown; error: unknown }) => T1 | PromiseLike<T1>) | null,
        onR?: ((e: unknown) => T2 | PromiseLike<T2>) | null,
      ) => Promise.resolve({ data: applyFilters(), error: null }).then(onF ?? undefined, onR ?? undefined),
    };
    return api;
  };

  return { from, calls };
}

let mockDb: ReturnType<typeof makeDb>;

jest.mock('@/lib/supabase-client', () => ({
  getSupabase: () => mockDb,
}));

import { POST as accountsPOST } from '@/app/api/accounts/route';
import { PUT as accountPUT, DELETE as accountDELETE } from '@/app/api/accounts/[id]/route';

const C1 = 'company-1';

function baseDb() {
  return {
    users: [{ id: 'u1', company_id: C1, is_active: true, token_version: 0, role: 'admin' }],
    subscriptions: [{ id: 's1', company_id: C1, status: 'active', end_date: '2099-01-01', plan_code: 'enterprise',
      subscription_plans: { code: 'enterprise', name: 'Enterprise', features_modules: {} } }],
    companies: [{ id: C1, is_active: true, token_version: 0 }],
    accounts: [] as Row[],
    journal_lines: [] as Row[],
    banks_safes: [] as Row[],
    fixed_assets: [] as Row[],
  };
}

function authedRequest(body?: Row) {
  const token = createToken('u1', 'admin');
  return {
    headers: {
      get: (k: string) => (k === 'authorization' ? `Bearer ${token}` : null),
    },
    cookies: { get: () => undefined },
    json: async () => body,
  } as unknown as NextRequest;
}

const paramsOf = (id: string) => ({ params: Promise.resolve({ id }) });

// ---------------------------------------------------------------------------
// 1. Default chart integrity
// ---------------------------------------------------------------------------

describe('Default chart of accounts — structural & accounting integrity', () => {
  test('codes are unique 4-digit numbers', () => {
    const codes = DEFAULT_CHART_OF_ACCOUNTS.map((a) => a.code);
    expect(new Set(codes).size).toBe(codes.length);
    for (const code of codes) expect(code).toMatch(/^\d{4}$/);
  });

  test('every parentCode exists and depth stays within 3 levels', () => {
    const byCode = new Map(DEFAULT_CHART_OF_ACCOUNTS.map((a) => [a.code, a]));
    for (const acc of DEFAULT_CHART_OF_ACCOUNTS) {
      if (acc.parentCode) expect(byCode.has(acc.parentCode)).toBe(true);
      let depth = 1;
      let cur = acc;
      while (cur.parentCode) {
        depth++;
        cur = byCode.get(cur.parentCode)!;
      }
      expect(depth).toBeLessThanOrEqual(3);
    }
  });

  test('accounting code bands match types (1xxx asset … 5xxx expense)', () => {
    const band: Record<string, string> = {
      '1': 'asset', '2': 'liability', '3': 'equity', '4': 'revenue', '5': 'expense',
    };
    for (const acc of DEFAULT_CHART_OF_ACCOUNTS) {
      expect(band[acc.code[0]]).toBe(acc.type);
    }
  });

  test('children keep the same type as their parent', () => {
    const byCode = new Map(DEFAULT_CHART_OF_ACCOUNTS.map((a) => [a.code, a]));
    for (const acc of DEFAULT_CHART_OF_ACCOUNTS) {
      if (acc.parentCode) {
        expect(byCode.get(acc.parentCode)!.type).toBe(acc.type);
      }
    }
  });

  test('critical accounts that other modules hard-depend on exist', () => {
    const byCode = new Map(DEFAULT_CHART_OF_ACCOUNTS.map((a) => [a.code, a]));
    // auto-account.ts opening balances post against 3100 (capital)
    expect(byCode.get('3100')).toMatchObject({ type: 'equity', parentCode: '3000' });
    // cash / banks / AR / AP / VAT / retained earnings / depreciation
    for (const code of ['1110', '1120', '1130', '1135', '2110', '1180', '2120', '3200', '5130', '5140', '5260', '1290']) {
      expect(byCode.has(code)).toBe(true);
    }
    expect(byCode.get('1290')!.parentCode).toBe('1200');
    expect(byCode.get('1000')!.isHeader).toBe(true);
    expect(byCode.get('1110')!.isHeader).toBeFalsy();
  });

  test('arabic and english names are non-empty', () => {
    for (const acc of DEFAULT_CHART_OF_ACCOUNTS) {
      expect(acc.name.trim().length).toBeGreaterThan(0);
      expect(acc.nameEn.trim().length).toBeGreaterThan(0);
    }
  });
});

// ---------------------------------------------------------------------------
// 2. createDefaultChartOfAccounts behaviour
// ---------------------------------------------------------------------------

describe('createDefaultChartOfAccounts', () => {
  test('creates every account scoped to the company and links parents', async () => {
    const db = baseDb();
    mockDb = makeDb(db);

    const created = await createDefaultChartOfAccounts(mockDb as unknown as SupabaseLike, C1);

    expect(created).toBe(DEFAULT_CHART_OF_ACCOUNTS.length);
    const accountInserts = mockDb.calls.filter((c) => c.mut.kind === 'insert' && c.table === 'accounts');
    expect(accountInserts).toHaveLength(DEFAULT_CHART_OF_ACCOUNTS.length);
    for (const c of accountInserts) expect((c.mut.payload as Row).company_id).toBe(C1);

    const cashSafe = mockDb.calls.find((c) => c.mut.kind === 'insert' && c.table === 'banks_safes');
    expect(cashSafe).toBeDefined();
    expect((cashSafe!.mut.payload as Row).type).toBe('safe');
    expect((cashSafe!.mut.payload as Row).name).toBe('الخزينة الرئيسية');

    const inserts = accountInserts;
    // Parent linking: 1110's update must point at the id that 1100 got
    const insertId = (code: string) =>
      (inserts.find((c) => (c.mut.payload as Row).code === code)?.mut.payload as Row).id;
    const updates = mockDb.calls.filter((c) => c.mut.kind === 'update');
    const childUpdate = updates.find((c) =>
      c.ops.some((o) => o.col === 'id' && o.val === insertId('1110'))
    );
    expect(childUpdate).toBeDefined();
    expect((childUpdate!.mut.payload as Row).parent_id).toBe(insertId('1100'));
    // updates are tenant-scoped
    for (const u of updates) {
      expect(u.ops.some((o) => o.op === 'eq' && o.col === 'company_id' && o.val === C1)).toBe(true);
    }
  });

  test('is idempotent — existing codes are re-linked, not duplicated', async () => {
    const db = baseDb();
    db.accounts.push(
      { id: 'pre-1000', company_id: C1, code: '1000' },
      { id: 'pre-1110', company_id: C1, code: '1110' },
    );
    mockDb = makeDb(db);

    const created = await createDefaultChartOfAccounts(mockDb as unknown as SupabaseLike, C1);

    const accountInserts = mockDb.calls.filter((c) => c.mut.kind === 'insert' && c.table === 'accounts');
    expect(accountInserts).toHaveLength(DEFAULT_CHART_OF_ACCOUNTS.length - 2);
    expect(accountInserts.find((c) => (c.mut.payload as Row).code === '1000')).toBeUndefined();
    expect(created).toBe(DEFAULT_CHART_OF_ACCOUNTS.length);
  });
});

// ---------------------------------------------------------------------------
// 3. Account API routes
// ---------------------------------------------------------------------------

describe('POST /api/accounts', () => {
  test('rejects invalid code format', async () => {
    mockDb = makeDb(baseDb());
    const res = await accountsPOST(authedRequest({
      code: '12ab', name: 'حساب', type: 'asset',
    }));
    expect(res.status).toBe(400);
  });

  test('rejects a parent from another company (cross-tenant)', async () => {
    const db = baseDb();
    db.accounts.push({ id: '00000000-0000-4000-8000-0000000000ff', company_id: 'company-2', code: '1000' });
    mockDb = makeDb(db);

    const res = await accountsPOST(authedRequest({
      code: '5999', name: 'حساب', type: 'expense', parentId: '00000000-0000-4000-8000-0000000000ff',
    }));
    expect(res.status).toBe(400);
    const json = await res.json();
    expect(json.message).toContain('الأب');
  });

  test('rejects duplicate code within the same company', async () => {
    const db = baseDb();
    db.accounts.push({ id: '00000000-0000-4000-8000-000000000001', company_id: C1, code: '5999' });
    mockDb = makeDb(db);

    const res = await accountsPOST(authedRequest({
      code: '5999', name: 'مكرر', type: 'expense',
    }));
    expect(res.status).toBe(400);
  });

  test('creates an account scoped to the company', async () => {
    mockDb = makeDb(baseDb());
    const res = await accountsPOST(authedRequest({
      code: '5999', name: 'مصروف مخصص', type: 'expense',
    }));
    expect(res.status).toBe(201);
    const insert = mockDb.calls.find((c) => c.mut.kind === 'insert' && c.table === 'accounts');
    expect((insert!.mut.payload as Row).company_id).toBe(C1);
    expect((insert!.mut.payload as Row).code).toBe('5999');
  });
});

describe('PUT /api/accounts/[id]', () => {
  test('rejects empty name', async () => {
    const db = baseDb();
    db.accounts.push({ id: '00000000-0000-4000-8000-000000000001', company_id: C1, code: '5999', name: 'قديم' });
    mockDb = makeDb(db);
    const res = await accountPUT(authedRequest({ name: '' }), paramsOf('00000000-0000-4000-8000-000000000001'));
    expect(res.status).toBe(400);
  });

  test('strips type/parentId — they can never be massaged via update', async () => {
    const db = baseDb();
    db.accounts.push({ id: '00000000-0000-4000-8000-000000000001', company_id: C1, code: '5999', name: 'قديم', type: 'expense' });
    mockDb = makeDb(db);

    const res = await accountPUT(authedRequest({
      name: 'اسم جديد',
      type: 'revenue',        // must NOT be applied
      parentId: '00000000-0000-4000-8000-0000000000ff' // must NOT be applied
    }), paramsOf('00000000-0000-4000-8000-000000000001'));

    expect(res.status).toBe(200);
    const upd = mockDb.calls.find((c) => c.mut.kind === 'update' && c.table === 'accounts');
    expect((upd!.mut.payload as Row).name).toBe('اسم جديد');
    expect(upd!.mut.payload).not.toHaveProperty('type');
    expect(upd!.mut.payload).not.toHaveProperty('parentId');
    expect(upd!.mut.payload).not.toHaveProperty('parent_id');
  });

  test('rejects duplicate code on rename and cross-tenant access', async () => {
    const db = baseDb();
    db.accounts.push(
      { id: '00000000-0000-4000-8000-000000000001', company_id: C1, code: '5999', name: 'أ' },
      { id: '00000000-0000-4000-8000-000000000002', company_id: C1, code: '5001', name: 'ب' },
      { id: '00000000-0000-4000-8000-000000000009', company_id: 'company-2', code: '5999', name: 'خارجي' },
    );
    mockDb = makeDb(db);

    const dup = await accountPUT(authedRequest({ code: '5001' }), paramsOf('00000000-0000-4000-8000-000000000001'));
    expect(dup.status).toBe(400);

    const foreign = await accountPUT(authedRequest({ name: 'x' }), paramsOf('00000000-0000-4000-8000-000000000009'));
    expect(foreign.status).toBe(404);
  });
});

describe('DELETE /api/accounts/[id]', () => {
  function seedAccount() {
    const db = baseDb();
    db.accounts.push({ id: '00000000-0000-4000-8000-000000000001', company_id: C1, code: '5999', name: 'حساب' });
    return db;
  }

  test('cross-tenant delete returns 404 (isolation)', async () => {
    const db = seedAccount();
    db.accounts.push({ id: '00000000-0000-4000-8000-000000000009', company_id: 'company-2', code: '5998', name: 'أجنبي' });
    mockDb = makeDb(db);
    const res = await accountDELETE(authedRequest(), paramsOf('00000000-0000-4000-8000-000000000009'));
    expect(res.status).toBe(404);
    expect(mockDb.calls.find((c) => c.mut.kind === 'delete')).toBeUndefined();
  });

  test('blocks delete when journal lines reference the account code', async () => {
    const db = seedAccount();
    db.journal_lines.push({ id: 'l1', company_id: C1, account_code: '5999' });
    mockDb = makeDb(db);
    const res = await accountDELETE(authedRequest(), paramsOf('00000000-0000-4000-8000-000000000001'));
    expect(res.status).toBe(400);
    const json = await res.json();
    expect(json.message).toContain('قيود');
    expect(mockDb.calls.find((c) => c.mut.kind === 'delete')).toBeUndefined();
  });

  test('blocks delete when a bank/safe is linked to the account', async () => {
    const db = seedAccount();
    db.banks_safes.push({ id: 'bs1', company_id: C1, account_id: '00000000-0000-4000-8000-000000000001' });
    mockDb = makeDb(db);
    const res = await accountDELETE(authedRequest(), paramsOf('00000000-0000-4000-8000-000000000001'));
    expect(res.status).toBe(400);
    const json = await res.json();
    expect(json.message).toContain('خزينة');
  });

  test('blocks delete when a fixed asset is linked to the account', async () => {
    const db = seedAccount();
    db.fixed_assets.push({ id: 'fa1', company_id: C1, asset_account_id: '00000000-0000-4000-8000-000000000001' });
    mockDb = makeDb(db);
    const res = await accountDELETE(authedRequest(), paramsOf('00000000-0000-4000-8000-000000000001'));
    expect(res.status).toBe(400);
    const json = await res.json();
    expect(json.message).toContain('أصل');
  });

  test('deletes a clean account, company-scoped', async () => {
    const db = seedAccount();
    mockDb = makeDb(db);
    const res = await accountDELETE(authedRequest(), paramsOf('00000000-0000-4000-8000-000000000001'));
    expect(res.status).toBe(200);
    const del = mockDb.calls.find((c) => c.mut.kind === 'delete' && c.table === 'accounts');
    expect(del).toBeDefined();
    expect(del!.ops.some((o) => o.col === 'company_id' && o.val === C1)).toBe(true);
    expect(del!.ops.some((o) => o.col === 'id' && o.val === '00000000-0000-4000-8000-000000000001')).toBe(true);
  });
});
