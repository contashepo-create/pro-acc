/**
 * Section 3 tests — Journal entries & numbering (double-entry core)
 *
 * 1. journalEntrySchema: both-sides line rule, balance, line count, dates
 * 2. insertJournalLines: hard failure on unresolved accounts + tenant scoping
 * 3. getNextJournalNumber fallback: per-year journal_sequences (not cross-year MAX)
 * 4. POST /api/journal legacy fallback path: lines carry company_id (regression),
 *    rollback on unknown account, pre-check balance rejection
 * 5. POST /api/journal primary RPC path: atomic creation, tenant params
 * 6. DELETE /api/journal/[id]: linked-record/reversal protection, tenant isolation
 */

process.env.TOKEN_SECRET = 'test-secret-key-for-unit-tests-32chars!';

// The DB-backed share of the per-user rate limit is out of scope for these
// suites (the memory fast path is what they exercise); the authoritative
// store is covered by shared-rate-limit.test.ts + the 077 migration smoke.
jest.mock('@/lib/shared-rate-limit', () => ({ hitSharedRateLimit: async () => ({ allowed: true, retryAfterSeconds: 0 }) }));
import * as fs from 'fs';
import * as path from 'path';
import { journalEntrySchema } from '@/lib/validation';
import { createToken } from '@/lib/auth';
import type { TestBuilder } from './mocks';
import type { NextRequest } from 'next/server';
import { insertJournalLines } from '@/lib/journal-utils';
import { getNextJournalNumber } from '@/lib/numbering';

// ---------------------------------------------------------------------------
// Chainable Supabase mock (with rpc support)
// ---------------------------------------------------------------------------

type Row = Record<string, unknown>;
type Op = { op: string; col?: string; val?: unknown };

function makeDb(db: Record<string, Row[]>) {
  const calls: Array<{ table: string; ops: Op[]; mut: { kind?: string; payload?: Row | Row[] } }> = [];
  let insertCounter = 0;
  const from = (table: string) => {
    const ops: Op[] = [];
    const mut: { kind?: string; payload?: Row | Row[] } = {};
    const call = { table, ops, mut };
    calls.push(call);

    const rows = () => db[table] || [];
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
      lte: () => api,
      order: () => api,
      limit: () => api,
      range: () => api,
      insert: (payload: Row | Row[]) => { mut.kind = 'insert'; mut.payload = payload; return api; },
      update: (payload: Row) => { mut.kind = 'update'; mut.payload = payload; return api; },
      delete: () => { mut.kind = 'delete'; return api; },
      maybeSingle: async () => ({ data: applyFilters()[0] ?? null, error: null }),
      single: async () => {
        if (mut.kind === 'insert') {
          mut.payload = { id: `id-${++insertCounter}`, ...mut.payload };
          (db[table] = db[table] || []).push(mut.payload);
          return { data: mut.payload, error: null };
        }
        const row = applyFilters()[0] ?? null;
        return { data: row, error: row ? null : { message: 'not found' } };
      },
      then: <T1 = { data: unknown; error: null }, T2 = never>(
        onF?: ((v: { data: unknown; error: unknown }) => T1 | PromiseLike<T1>) | null,
        onR?: ((e: unknown) => T2 | PromiseLike<T2>) | null,
      ) => Promise.resolve({ data: applyFilters(), error: null }).then(onF ?? undefined, onR ?? undefined),
    };
    return api;
  };

  const rpcCalls: Array<{ name: string; params?: Row }> = [];
  const rpcImpl = async (_name: string, _params?: Row): Promise<{ data: unknown; error: unknown }> =>
    ({ data: null, error: { message: `Could not find the function ${_name}` } });
  const db_ = {
    from,
    calls,
    rpcCalls,
    rpcImpl,
    rpc: (name: string, params?: Row) => {
      rpcCalls.push({ name, params });
      return db_.rpcImpl(name, params);
    },
  };
  return db_;
}

let mockDb: ReturnType<typeof makeDb>;

jest.mock('@/lib/supabase-client', () => ({
  getSupabase: () => mockDb,
}));

import { POST as journalPOST } from '@/app/api/journal/route';
import { DELETE as journalDELETE } from '@/app/api/journal/[id]/route';

const C1 = 'company-1';
const A1 = '00000000-0000-4000-8000-0000000000a1';
const A2 = '00000000-0000-4000-8000-0000000000a2';

function baseDb() {
  return {
    users: [{ id: 'u1', company_id: C1, is_active: true, token_version: 0, role: 'admin' }],
    companies: [{ id: C1, is_active: true, token_version: 0 }],
    accounts: [
      { id: A1, company_id: C1, code: '1110', name: 'النقدية' },
      { id: A2, company_id: C1, code: '4100', name: 'إيرادات' },
    ],
    journal_entries: [] as Row[],
    journal_lines: [] as Row[],
        subscriptions: [{
      id: 's1', company_id: C1, plan_id: 'p1', plan_code: 'enterprise', status: 'active',
      start_date: '2024-01-01',
      end_date: new Date(Date.now() + 30 * 86400000).toISOString().split('T')[0],
      subscription_plans: { code: 'enterprise', name: 'Enterprise', features_modules: {
        dashboard: true, accounts: true, journal: true, invoices: true, quotations: true,
        clients: true, contacts: true, reports_basic: true, reports_advanced: true,
        reports_consolidated: true, settings: true, subscription: true, inventory: true,
        purchases: true, cost_centers: true, banks: true, cash: true, warehouses: true,
        branches: true, tax_reports: true, fixed_assets: true, pos: true, workflows: true,
        approvals: true, custody: true, employees: true, projects: true, budgets: true,
        messages: true, crm: true, contracts: true, tenders: true, boq: true,
        progress_billing: true, subcontractors: true, payroll: true
      } },
    }],
journal_sequences: [] as Row[],
    invoices: [] as Row[],
    custodies: [] as Row[],
  } as Record<string, Row[]>;
}

function authedRequest(body?: Row) {
  const token = createToken('u1', 'admin');
  return {
    headers: { get: (k: string) => (k === 'authorization' ? `Bearer ${token}` : null) },
    cookies: { get: () => undefined },
    json: async () => body,
    nextUrl: new URL('http://localhost/api/journal'),
  } as unknown as NextRequest;
}

const paramsOf = (id: string) => ({ params: Promise.resolve({ id }) });

const balancedBody = {
  date: '2026-08-01',
  type: 'general',
  description: 'قيد اختبار',
  lines: [
    { accountCode: '1110', debit: 1150, credit: 0 },
    { accountCode: '4100', debit: 0, credit: 1000 },
    { accountCode: '2120' , debit: 0, credit: 150 },
  ],
};

function withTaxAccount(db: Record<string, Row[]>) {
  db.accounts.push({ id: '00000000-0000-4000-8000-0000000000a3', company_id: C1, code: '2120', name: 'ضريبة المبيعات' });
  return db;
}

// ---------------------------------------------------------------------------
// 1. Schema rules
// ---------------------------------------------------------------------------

describe('journalEntrySchema — double-entry rules', () => {
  test('rejects a line that is both debit and credit', () => {
    const res = journalEntrySchema.safeParse({
      date: '2026-08-01', type: 'general',
      lines: [
        { accountCode: '1110', debit: 100, credit: 50 },
        { accountCode: '4100', debit: 0, credit: 50 },
      ],
    });
    expect(res.success).toBe(false);
    if (!res.success) expect(res.error.issues[0].message).toContain('مديناً ودائناً');
  });

  test('rejects unbalanced entries even within 0.015', () => {
    const res = journalEntrySchema.safeParse({
      date: '2026-08-01', type: 'general',
      lines: [
        { accountCode: '1110', debit: 100, credit: 0 },
        { accountCode: '4100', debit: 0, credit: 99.989 },
      ],
    });
    expect(res.success).toBe(false);
  });

  test('rejects precision that the NUMERIC(15,2) ledger would round', () => {
    expect(journalEntrySchema.safeParse({
      date: '2026-08-01', type: 'general',
      lines: [
        { accountCode: '1110', debit: 10.001, credit: 0 },
        { accountCode: '4100', debit: 0, credit: 10.001 },
      ],
    }).success).toBe(false);
  });

  test('rejects fewer than 2 lines, negative amounts and bad dates', () => {
    expect(journalEntrySchema.safeParse({
      date: '2026-08-01', type: 'general',
      lines: [{ accountCode: '1110', debit: 100, credit: 0 }],
    }).success).toBe(false);

    expect(journalEntrySchema.safeParse({
      date: '2026-08-01', type: 'general',
      lines: [
        { accountCode: '1110', debit: -5, credit: 0 },
        { accountCode: '4100', debit: 0, credit: -5 },
      ],
    }).success).toBe(false);

    expect(journalEntrySchema.safeParse({
      date: '2026-02-30', type: 'general',
      lines: [
        { accountCode: '1110', debit: 5, credit: 0 },
        { accountCode: '4100', debit: 0, credit: 5 },
      ],
    }).success).toBe(false);
  });

  test('accepts a balanced multi-line entry', () => {
    const res = journalEntrySchema.safeParse({
      date: '2026-08-01', type: 'general',
      lines: [
        { accountCode: '1110', debit: 1150, credit: 0 },
        { accountCode: '4100', debit: 0, credit: 1000 },
        { accountCode: '2120', debit: 0, credit: 150 },
      ],
    });
    expect(res.success).toBe(true);
  });

  test('rejects the same account as both debit and credit in one entry', () => {
    const res = journalEntrySchema.safeParse({
      date: '2026-08-01', type: 'general',
      lines: [
        { accountCode: '1110', debit: 500, credit: 0 },
        { accountCode: '1110', debit: 0, credit: 200 },
        { accountCode: '4100', debit: 0, credit: 300 },
      ],
    });
    expect(res.success).toBe(false);
    if (!res.success) expect(res.error.issues[0].message).toContain('نفس الحساب');
  });

  test('allows the same account repeated on ONE side only (net posting stays compliant)', () => {
    const res = journalEntrySchema.safeParse({
      date: '2026-08-01', type: 'general',
      lines: [
        { accountCode: '1110', debit: 300, credit: 0 },
        { accountCode: '1110', debit: 200, credit: 0 },
        { accountCode: '4100', debit: 0, credit: 500 },
      ],
    });
    expect(res.success).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// 2. insertJournalLines integrity
// ---------------------------------------------------------------------------

describe('SQL journal RPCs write company_id', () => {

  test('hardened journal RPC binds every account and related entity to its tenant', () => {
    const sql = fs.readFileSync(path.join(__dirname, '../migrations/047-harden-atomic-journal-entry.sql'), 'utf8');
    expect(sql).toMatch(/accounts[\s\S]*company_id = p_company_id/);
    expect(sql).toMatch(/contacts[\s\S]*company_id = p_company_id/);
    expect(sql).toMatch(/projects[\s\S]*company_id = p_company_id/);
    expect(sql).toMatch(/COALESCE\(is_header, false\) = false/);
    expect(sql).toMatch(/next_journal_number\(p_company_id/);
    expect(sql).toMatch(/jsonb_array_length\(p_lines\) < 2/);
  });

  test('database trigger enforces tenant ownership for every direct ledger insert', () => {
    const sql = fs.readFileSync(path.join(__dirname, '../migrations/048-ledger-row-integrity-trigger.sql'), 'utf8');
    expect(sql).toContain('trg_enforce_journal_line_integrity');
    expect(sql).toMatch(/journal_entries[\s\S]*company_id = NEW\.company_id/);
    expect(sql).toMatch(/accounts[\s\S]*company_id = NEW\.company_id/);
    expect(sql).toMatch(/contacts[\s\S]*company_id = NEW\.company_id/);
    expect(sql).toMatch(/projects[\s\S]*company_id = NEW\.company_id/);
  });

  test('create_journal_entry / create_invoice_with_journal INSERT lists include company_id', () => {
    const migrationsDir = path.join(__dirname, '../migrations');
    const files = [
      '012-atomic-journal-entry-insert.sql',
      '014-atomic-invoice-creation.sql',
      '022-fix-journal-lines-company-id.sql',
      '023-fix-child-rows-company-id.sql',
    ];
    for (const file of files) {
      const sql = fs.readFileSync(path.join(migrationsDir, file), 'utf8');
      const inserts = [...sql.matchAll(/INSERT INTO journal_lines\s*\(([^)]+)\)/gi)];
      expect(inserts.length).toBeGreaterThan(0);
      for (const m of inserts) {
        expect(m[1]).toMatch(/company_id/i);
      }
    }
  });
});

describe('insertJournalLines', () => {
  test('fails loudly when an account cannot be resolved (no 0000 fallback)', async () => {
    mockDb = makeDb(baseDb());
    const { error } = await insertJournalLines(C1, [{
      journal_entry_id: 'je-1',
      account_id: '00000000-0000-4000-8000-00000000dead', // not in db
      debit: 100, credit: 0,
    }, {
      journal_entry_id: 'je-1', account_id: A2, debit: 0, credit: 100,
    }]);
    expect(error).toBeTruthy();
    expect(String((error as { message?: string }).message)).toContain('تعذر العثور');
    expect(mockDb.calls.find((c) => c.mut.kind === 'insert' && c.table === 'journal_lines')).toBeUndefined();
  });

  test('account lookup is tenant-scoped and payload carries company_id', async () => {
    mockDb = makeDb(baseDb());
    const { error } = await insertJournalLines(C1, [
      { journal_entry_id: 'je-1', account_id: A1, debit: 100, credit: 0 },
      { journal_entry_id: 'je-1', account_id: A2, debit: 0, credit: 100 },
    ]);
    expect(error).toBeNull();

    const accQuery = mockDb.calls.find((c) => c.table === 'accounts');
    expect(accQuery!.ops.some((o) => o.op === 'eq' && o.col === 'company_id' && o.val === C1)).toBe(true);

    const insert = mockDb.calls.find((c) => c.mut.kind === 'insert' && c.table === 'journal_lines');
    const payload = insert!.mut.payload as Row[];
    expect(payload).toHaveLength(2);
    for (const l of payload) {
      expect(l.company_id).toBe(C1);
      expect(l.account_code).toMatch(/^\d{4}$/);
      expect(l.account_name).toBeTruthy();
    }
  });
});

// ---------------------------------------------------------------------------
// 3. Journal numbering fallback
// ---------------------------------------------------------------------------

describe('getNextJournalNumber fallback parity with RPC semantics', () => {
  test('first entry of the year starts at 1 and seeds journal_sequences', async () => {
    mockDb = makeDb(baseDb());
    const n = await getNextJournalNumber(C1, '2026-08-01');
    expect(n).toBe(1);
    const insert = mockDb.calls.find((c) => c.mut.kind === 'insert' && c.table === 'journal_sequences');
    expect(insert!.mut.payload).toMatchObject({ company_id: C1, year: 2026, last_number: 1 });
  });

  test('existing sequence increments per (company, year)', async () => {
    const db = baseDb();
    db.journal_sequences.push({ company_id: C1, year: 2026, last_number: 7 });
    mockDb = makeDb(db);
    const n = await getNextJournalNumber(C1, 2026);
    expect(n).toBe(8);
    const upd = mockDb.calls.find((c) => c.mut.kind === 'update' && c.table === 'journal_sequences');
    expect((upd!.mut.payload as Row).last_number).toBe(8);
    expect(upd!.ops.some((o) => o.col === 'year' && o.val === 2026)).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// 4. POST /api/journal — legacy fallback path
// ---------------------------------------------------------------------------

describe('POST /api/journal — atomic posting boundary', () => {
  test('rejects unbalanced entries before calling PostgreSQL', async () => {
    mockDb = makeDb(withTaxAccount(baseDb()));
    const res = await journalPOST(authedRequest({
      ...balancedBody,
      lines: [
        { accountCode: '1110', debit: 100, credit: 0 },
        { accountCode: '4100', debit: 0, credit: 50 },
      ],
    }));
    expect(res.status).toBe(400);
    expect(mockDb.rpcCalls).toHaveLength(0);
  });

  test('rejects an account outside the tenant before posting', async () => {
    mockDb = makeDb(baseDb()); // no 2120 account
    const res = await journalPOST(authedRequest(balancedBody));
    expect(res.status).toBe(400);
    expect((await res.json()).message).toContain('غير موجود');
    expect(mockDb.rpcCalls).toHaveLength(0);
  });

  test('resolves tenant accounts then posts through one RPC with trusted context', async () => {
    const db = withTaxAccount(baseDb());
    db.journal_entries.push({ id: 'je-rpc-1', company_id: C1, number: 5, date: '2026-08-01', type: 'general', description: 'قيد اختبار', created_at: 'x' });
    db.journal_lines.push(
      { id: 'l1', company_id: C1, journal_entry_id: 'je-rpc-1', account_code: '1110', debit: 1150, credit: 0 },
      { id: 'l2', company_id: C1, journal_entry_id: 'je-rpc-1', account_code: '4100', debit: 0, credit: 1000 },
      { id: 'l3', company_id: C1, journal_entry_id: 'je-rpc-1', account_code: '2120', debit: 0, credit: 150 },
    );
    mockDb = makeDb(db);
    mockDb.rpcImpl = async (name: string) => name === 'create_journal_entry'
      ? { data: { id: 'je-rpc-1', number: 5, total_debit: 1150, total_credit: 1150, lines_count: 3 }, error: null }
      : { data: null, error: { message: `missing ${name}` } };

    const res = await journalPOST(authedRequest(balancedBody));
    expect(res.status).toBe(201);
    expect((await res.json()).data).toMatchObject({ totalDebit: 1150, totalCredit: 1150 });
    expect(mockDb.rpcCalls[0]).toMatchObject({
      name: 'create_journal_entry',
      params: { p_company_id: C1, p_created_by: 'u1', p_date: '2026-08-01', p_type: 'general' },
    });
    const rpcLines = (mockDb.rpcCalls[0].params?.p_lines ?? []) as Row[];
    expect(rpcLines).toHaveLength(3);
    expect(rpcLines.every((line) => line.accountId)).toBe(true);
    expect(mockDb.calls.find((call) => call.mut.kind === 'insert' && call.table === 'journal_entries')).toBeUndefined();
  });

  test('does not fall back to partial route writes when the RPC rejects', async () => {
    mockDb = makeDb(withTaxAccount(baseDb()));
    mockDb.rpcImpl = async () => ({ data: null, error: { code: 'P0001', message: 'السنة المالية مغلقة' } });
    const res = await journalPOST(authedRequest(balancedBody));
    expect(res.status).toBe(409);
    expect(mockDb.calls.find((call) => call.mut.kind === 'insert' && ['journal_entries', 'journal_lines'].includes(call.table))).toBeUndefined();
  });
});

describe('DELETE /api/journal/[id] — reversal-only lifecycle', () => {
  function seedEntry(db: Record<string, Row[]>) {
    db.journal_entries.push({ id: 'je-1', company_id: C1, number: 9, date: '2026-08-01', type: 'general', description: 'قيد' });
    return db;
  }

  test('cross-tenant access returns 404 without invoking reversal', async () => {
    const db = seedEntry(baseDb());
    db.journal_entries.push({ id: 'je-9', company_id: 'company-2', number: 1 });
    mockDb = makeDb(db);
    const res = await journalDELETE(authedRequest(), paramsOf('je-9'));
    expect(res.status).toBe(404);
    expect(mockDb.rpcCalls).toHaveLength(0);
  });

  test('creates an atomic reversal and never hard-deletes ledger rows', async () => {
    mockDb = makeDb(seedEntry(baseDb()));
    mockDb.rpcImpl = async (name: string) => name === 'post_journal_reversal'
      ? { data: { id: 'je-reversal-1' }, error: null }
      : { data: null, error: { message: `missing ${name}` } };
    const res = await journalDELETE(authedRequest(), paramsOf('je-1'));
    expect(res.status).toBe(200);
    expect(mockDb.rpcCalls[0]).toMatchObject({
      name: 'post_journal_reversal',
      params: { p_company_id: C1, p_journal_entry_id: 'je-1', p_user_id: 'u1' },
    });
    expect(mockDb.calls.find((call) => call.mut.kind === 'delete')).toBeUndefined();
  });
});
