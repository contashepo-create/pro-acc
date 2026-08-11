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

import { journalEntrySchema } from '@/lib/validation';
import { createToken } from '@/lib/auth';
import { insertJournalLines } from '@/lib/journal-utils';
import { getNextJournalNumber } from '@/lib/numbering';

// ---------------------------------------------------------------------------
// Chainable Supabase mock (with rpc support)
// ---------------------------------------------------------------------------

type Row = Record<string, any>;
type Op = { op: string; col?: string; val?: any };

function makeDb(db: Record<string, Row[]>) {
  const calls: Array<{ table: string; ops: Op[]; mut: { kind?: string; payload?: any } }> = [];
  let insertCounter = 0;
  const api_holders: any = {};

  const from = (table: string) => {
    const ops: Op[] = [];
    const mut: { kind?: string; payload?: any } = {};
    const call: any = { table, ops, mut };
    calls.push(call);

    const rows = () => db[table] || [];
    const applyFilters = () =>
      rows().filter((r) =>
        ops.every((o) => {
          if (o.op === 'eq') return r[o.col!] === o.val;
          if (o.op === 'neq') return r[o.col!] !== o.val;
          if (o.op === 'in') return (o.val as any[]).includes(r[o.col!]);
          return true;
        })
      );

    const api: any = {
      select: () => api,
      eq: (col: string, val: any) => { ops.push({ op: 'eq', col, val }); return api; },
      neq: (col: string, val: any) => { ops.push({ op: 'neq', col, val }); return api; },
      in: (col: string, val: any) => { ops.push({ op: 'in', col, val }); return api; },
      or: () => api,
      gte: () => api,
      lte: () => api,
      order: () => api,
      limit: () => api,
      range: () => api,
      insert: (payload: any) => { mut.kind = 'insert'; mut.payload = payload; return api; },
      update: (payload: any) => { mut.kind = 'update'; mut.payload = payload; return api; },
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
      then: (onF: any, onR: any) =>
        Promise.resolve({ data: applyFilters(), error: null }).then(onF, onR),
    };
    return api;
  };

  const db_: any = { from, calls };
  db_.rpcImpl = async (_name: string, _params: any) => ({
    data: null,
    error: { message: `Could not find the function ${_name}` },
  });
  db_.rpc = (name: string, params: any) => db_.rpcImpl(name, params);
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
    users: [{ id: 'u1', company_id: C1, is_active: true, role: 'admin' }],
    companies: [{ id: C1, is_active: true }],
    accounts: [
      { id: A1, company_id: C1, code: '1110', name: 'النقدية' },
      { id: A2, company_id: C1, code: '4100', name: 'إيرادات' },
    ],
    journal_entries: [] as Row[],
    journal_lines: [] as Row[],
    journal_sequences: [] as Row[],
    invoices: [] as Row[],
    custodies: [] as Row[],
  } as Record<string, Row[]>;
}

function authedRequest(body?: any) {
  const token = createToken('u1', 'admin');
  return {
    headers: { get: (k: string) => (k === 'authorization' ? `Bearer ${token}` : null) },
    cookies: { get: () => undefined },
    json: async () => body,
    nextUrl: new URL('http://localhost/api/journal'),
  } as any;
}

const paramsOf = (id: string) => ({ params: Promise.resolve({ id }) });

const balancedBody = {
  date: '2026-08-01',
  type: 'general',
  description: 'قيد اختبار',
  lines: [
    { accountCode: '1110', debit: 1150, credit: 0 },
    { accountCode: '4100', debit: 0, credit: 1000 },
    { accountCode: '2120' , debit: 0, credit: 150 } as any,
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

describe('insertJournalLines', () => {
  test('fails loudly when an account cannot be resolved (no 0000 fallback)', async () => {
    mockDb = makeDb(baseDb());
    const { error } = await insertJournalLines(C1, [{
      journal_entry_id: 'je-1',
      account_id: '00000000-0000-4000-8000-00000000dead', // not in db
      debit: 100, credit: 0,
    }]);
    expect(error).toBeTruthy();
    expect(String(error.message)).toContain('تعذر العثور');
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
    expect(upd!.mut.payload.last_number).toBe(8);
    expect(upd!.ops.some((o) => o.col === 'year' && o.val === 2026)).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// 4. POST /api/journal — legacy fallback path
// ---------------------------------------------------------------------------

describe('POST /api/journal (legacy fallback path)', () => {
  test('inserted journal_lines carry company_id (regression)', async () => {
    mockDb = makeDb(withTaxAccount(baseDb()));
    const res = await journalPOST(authedRequest(balancedBody));
    expect(res.status).toBe(201);

    const lineInserts = mockDb.calls.filter((c) => c.mut.kind === 'insert' && c.table === 'journal_lines');
    expect(lineInserts.length).toBeGreaterThan(0);
    for (const ins of lineInserts) {
      const rows = Array.isArray(ins.mut.payload) ? ins.mut.payload : [ins.mut.payload];
      for (const r of rows) {
        expect(r.company_id).toBe(C1);
        expect(r.account_name).toBeTruthy();
      }
    }
    // journal entry itself is tenant-scoped
    const je = mockDb.calls.find((c) => c.mut.kind === 'insert' && c.table === 'journal_entries');
    expect(je!.mut.payload.company_id).toBe(C1);
  });

  test('rolls back the entry when an account code does not exist', async () => {
    mockDb = makeDb(baseDb()); // no 2120 account here
    const res = await journalPOST(authedRequest(balancedBody));
    expect(res.status).toBe(400);
    const json = await res.json();
    expect(json.message).toContain('غير موجود');
    // no committed entry and no orphan lines anywhere
    expect(mockDb.calls.find((c) => c.mut.kind === 'insert' && c.table === 'journal_entries')).toBeUndefined();
    expect(mockDb.calls.find((c) => c.mut.kind === 'insert' && c.table === 'journal_lines')).toBeUndefined();
  });

  test('rejects clearly unbalanced entries before touching the database', async () => {
    mockDb = makeDb(withTaxAccount(baseDb()));
    const unbalanced = {
      ...balancedBody,
      lines: [
        { accountCode: '1110', debit: 100, credit: 0 },
        { accountCode: '4100', debit: 0, credit: 50 },
      ],
    };
    const res = await journalPOST(authedRequest(unbalanced));
    expect(res.status).toBe(400);
    const json = await res.json();
    expect(json.message).toContain('الدائنين');
    // schema-level rejection: zero database mutations
    expect(mockDb.calls.find((c) => c.mut.kind === 'insert')).toBeUndefined();
  });
});

// ---------------------------------------------------------------------------
// 5. POST /api/journal — primary atomic RPC path
// ---------------------------------------------------------------------------

describe('POST /api/journal (atomic RPC path)', () => {
  test('creates via RPC with tenant params and returns totals', async () => {
    const db = withTaxAccount(baseDb());
    db.journal_entries.push({ id: 'je-rpc-1', company_id: C1, number: 5, date: '2026-08-01', type: 'general', description: 'قيد', created_at: 'x' });
    db.journal_lines.push(
      { id: 'l1', journal_entry_id: 'je-rpc-1', account_code: '1110', debit: 1150, credit: 0 },
      { id: 'l2', journal_entry_id: 'je-rpc-1', account_code: '4100', debit: 0, credit: 1000 },
    );
    mockDb = makeDb(db);
    mockDb.rpcImpl = async (name: string, params: any) => {
      if (name === 'create_journal_entry') {
        expect(params.p_company_id).toBe(C1);
        expect(params.p_created_by).toBe('u1');
        return { data: { id: 'je-rpc-1', number: 5, total_debit: 1150, total_credit: 1150, lines_count: 2 }, error: null };
      }
      return { data: null, error: { message: `Could not find the function ${name}` } };
    };

    const res = await journalPOST(authedRequest(balancedBody));
    expect(res.status).toBe(201);
    const json = await res.json();
    expect(json.data.totalDebit).toBe(1150);
    expect(json.data.totalCredit).toBe(1150);
  });

  test('surfaces RPC balance violations as 400', async () => {
    mockDb = makeDb(withTaxAccount(baseDb()));
    mockDb.rpcImpl = async () => ({ data: null, error: { message: 'خطأ في الموازنة: المدين لا يساوي الدائن', code: 'P0001' } });
    const res = await journalPOST(authedRequest(balancedBody));
    expect(res.status).toBe(400);
  });
});

// ---------------------------------------------------------------------------
// 6. DELETE /api/journal/[id] protections
// ---------------------------------------------------------------------------

describe('DELETE /api/journal/[id]', () => {
  function seedEntry(db: Record<string, Row[]>) {
    db.journal_entries.push({ id: 'je-1', company_id: C1, number: 9, date: '2026-08-01', type: 'general' });
    return db;
  }

  test('blocks delete when an invoice is linked to the entry', async () => {
    const db = seedEntry(baseDb());
    db.invoices.push({ id: 'inv-1', company_id: C1, journal_entry_id: 'je-1' });
    mockDb = makeDb(db);
    const res = await journalDELETE(authedRequest(), paramsOf('je-1'));
    expect(res.status).toBe(400);
    const json = await res.json();
    expect(json.message).toContain('فاتورة');
    expect(mockDb.calls.find((c) => c.mut.kind === 'delete')).toBeUndefined();
  });

  test('blocks delete when a reversal entry references it', async () => {
    const db = seedEntry(baseDb());
    db.journal_entries.push({ id: 'je-rev', company_id: C1, reference: 'je-1' });
    mockDb = makeDb(db);
    const res = await journalDELETE(authedRequest(), paramsOf('je-1'));
    expect(res.status).toBe(400);
    const json = await res.json();
    expect(json.message).toContain('عكسية');
  });

  test('deletes lines then entry for a clean entry', async () => {
    mockDb = makeDb(seedEntry(baseDb()));
    const res = await journalDELETE(authedRequest(), paramsOf('je-1'));
    expect(res.status).toBe(200);
    const delLines = mockDb.calls.find((c) => c.mut.kind === 'delete' && c.table === 'journal_lines');
    const delEntry = mockDb.calls.find((c) => c.mut.kind === 'delete' && c.table === 'journal_entries');
    expect(delLines).toBeDefined();
    expect(delEntry).toBeDefined();
  });

  test('cross-tenant access returns 404', async () => {
    const db = seedEntry(baseDb());
    db.journal_entries.push({ id: 'je-9', company_id: 'company-2', number: 1 });
    mockDb = makeDb(db);
    const res = await journalDELETE(authedRequest(), paramsOf('je-9'));
    expect(res.status).toBe(404);
  });
});
