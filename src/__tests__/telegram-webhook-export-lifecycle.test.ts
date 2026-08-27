/**
 * End-to-end lifecycle tests for the operational surfaces that sit outside the
 * accounting core: the company TABLE export (Excel/CSV — the only self-service
 * data download left) and the Telegram webhook.
 *
 * The behaviours pinned here are the ones whose failure is silent and
 * therefore most dangerous:
 *  - an export must be COMPLETE or fail loudly. Truncating at a row cap, or
 *    swallowing a read error into an empty array, produces a file the client
 *    trusts and then loses the rows it never contained when migrating away.
 *  - the Telegram webhook is an unauthenticated internet endpoint: it must
 *    verify the shared secret whenever one is configured and reject a
 *    present-but-mismatched header, while still processing updates from bots
 *    registered before the secret-token scheme (no header at all) so that
 *    inline approval buttons never die silently for legacy deployments.
 */
// The DB-backed share of the per-user rate limit is out of scope for these
// suites (the memory fast path is what they exercise); the authoritative
// store is covered by shared-rate-limit.test.ts + the 077 migration smoke.
jest.mock('@/lib/shared-rate-limit', () => ({ hitSharedRateLimit: async () => ({ allowed: true, retryAfterSeconds: 0 }) }));
import { randomBytes } from 'crypto';

// Generated per run rather than written as literals: hardcoded credential
// strings are what secret scanners flag, and normalising them in tests is how
// real leaks eventually slip through.
process.env.TOKEN_SECRET = 'test-secret-key-for-unit-tests-32chars!';
process.env.TELEGRAM_WEBHOOK_SECRET = randomBytes(24).toString('hex');
process.env.TELEGRAM_BOT_TOKEN = randomBytes(16).toString('hex');

import { createToken } from '@/lib/auth';
import type { TestBuilder } from './mocks';
import type { NextRequest } from 'next/server';

type Row = Record<string, unknown>;
type Op = { op: string; col?: string; val?: unknown };

function makeDb(db: Record<string, Row[]>) {
  const calls: Array<{ table: string; ops: Op[]; mut: { kind?: string; payload?: Row | Row[] } }> = [];
  const rpcCalls: Array<{ name: string; params?: Row }> = [];
  const rpcResults = new Map<string, { data: unknown; error: unknown }>();
  const tableErrors = new Map<string, { message: string; code?: string }>();

  const from = (table: string) => {
    const ops: Op[] = []; const mut: { kind?: string; payload?: Row | Row[] } = {}; calls.push({ table, ops, mut });
    let rangeBounds: { from: number; to: number } | null = null;
    const filtered = () => (db[table] || []).filter((row) => ops.every((op) => {
      if (op.op === 'eq') return row[op.col!] === op.val;
      if (op.op === 'in') return (op.val as unknown[]).includes(row[op.col!]);
      if (op.op === 'neq') return row[op.col!] !== op.val;
      return true;
    }));
    const api: TestBuilder = {
      select: () => api,
      eq: (col: string, val: unknown) => { ops.push({ op: 'eq', col, val }); return api; },
      in: (col: string, val: unknown) => { ops.push({ op: 'in', col, val }); return api; },
      neq: () => api, is: () => api, or: () => api, not: () => api,
      gte: () => api, lte: () => api, lt: () => api, order: () => api, limit: () => api,
      // PostgREST range() bounds are inclusive.
      range: (start: number, end: number) => { rangeBounds = { from: start, to: end }; return api; },
      insert: (payload: Row | Row[]) => { mut.kind = 'insert'; mut.payload = payload; return api; },
      update: (payload: Row) => { mut.kind = 'update'; mut.payload = payload; return api; },
      upsert: (payload: Row | Row[]) => { mut.kind = 'upsert'; mut.payload = payload; return api; },
      delete: () => { mut.kind = 'delete'; return api; },
      maybeSingle: async () => ({ data: filtered()[0] || null, error: tableErrors.get(table) || null }),
      single: async () => {
        if (mut.kind === 'insert' || mut.kind === 'upsert') return { data: filtered()[0] ?? mut.payload, error: null };
        const row = filtered()[0] || null;
        return { data: row, error: row ? null : { message: 'not found' } };
      },
      then: <T1 = { data: unknown; error: unknown; count?: number }, T2 = never>(
        ok?: ((v: { data: unknown; error: unknown; count?: number }) => T1 | PromiseLike<T1>) | null,
        fail?: ((e: unknown) => T2 | PromiseLike<T2>) | null,
      ) => {
        const tableError = tableErrors.get(table);
        if (tableError) return Promise.resolve({ data: null, error: tableError, count: 0 }).then(ok ?? undefined, fail ?? undefined);
        const all = filtered();
        const page = rangeBounds ? all.slice(rangeBounds.from, rangeBounds.to + 1) : all;
        return Promise.resolve({ data: page, error: null, count: all.length }).then(ok ?? undefined, fail ?? undefined);
      },
    };
    return api;
  };

  return {
    from, calls, rpcCalls, rpcResults, tableErrors,
    storage: {
      from: () => ({
        upload: async () => ({ data: { path: 'x' }, error: null }),
        remove: async () => ({ data: null, error: null }),
        createSignedUrl: async () => ({ data: { signedUrl: 'https://signed.example/x' }, error: null }),
      }),
    },
    rpc: async (name: string, params?: Row): Promise<{ data: unknown; error: unknown }> => {
      rpcCalls.push({ name, params });
      return rpcResults.get(name) || { data: { ok: true }, error: null };
    },
  };
}

let mockDb: ReturnType<typeof makeDb>;
jest.mock('@/lib/supabase-client', () => ({ getSupabase: () => mockDb }));

import { POST as exportDownloadPOST } from '@/app/api/company/export-download/route';
import { POST as telegramWebhookPOST } from '@/app/api/telegram/webhook/route';

const C1 = 'company-1';
const ADMIN = 'u-admin';

function baseDb(): Record<string, Row[]> {
  return {
    users: [{ id: ADMIN, company_id: C1, role: 'admin', is_active: true, token_version: 0, name: 'مدير' }],
    companies: [{ id: C1, name: 'شركة', email: 'co@example.com', phone: '0500', is_active: true }],
    subscriptions: [{
      id: 's1', company_id: C1, plan_code: 'enterprise', status: 'active',
      start_date: '2024-01-01', end_date: '2099-01-01',
      subscription_plans: { code: 'enterprise', features_modules: { dashboard: true, reports: true } },
    }],
    accounts: [], journal_entries: [], journal_lines: [], invoices: [], invoice_items: [],
    contacts: [], clients: [], projects: [], banks_safes: [], cash_transactions: [],
    inventory_items: [], employees: [], payroll: [],
    security_audit_log: [], audit_log: [],
  };
}

function adminRequest(body?: Row, method = 'POST', url = 'http://localhost/api/company/export-download') {
  const token = createToken(ADMIN, 'admin');
  return {
    url, method,
    headers: { get: (key: string) => (key === 'authorization' ? `Bearer ${token}` : null) },
    cookies: { get: () => undefined },
    json: async () => body,
  } as unknown as NextRequest;
}

function webhookRequest(payload: Row, secret: string | null = process.env.TELEGRAM_WEBHOOK_SECRET!) {
  return {
    url: 'http://localhost/api/telegram/webhook',
    method: 'POST',
    headers: {
      get: (key: string) => (key.toLowerCase() === 'x-telegram-bot-api-secret-token' ? secret : null),
    },
    json: async () => payload,
  } as unknown as NextRequest;
}

beforeEach(() => {
  mockDb = makeDb(baseDb());
  global.fetch = jest.fn(async () => ({ ok: true, status: 200, json: async () => ({ ok: true }) })) as unknown as typeof fetch;
});

describe('company report export — تقارير احترافية (Excel/CSV فقط)', () => {
  test('a report larger than one page is exported in full, not truncated', async () => {
    const db = baseDb();
    // 2,500 journal lines spans three 1,000-row pages.
    db.journal_lines = Array.from({ length: 2500 }, (_, index) => ({
      id: `jl-${String(index).padStart(5, '0')}`, company_id: C1,
      account_code: '4100', account_name: 'الإيرادات', description: `بند-${index}`,
      debit: 1, credit: 0,
    }));
    mockDb = makeDb(db);

    const response = await exportDownloadPOST(adminRequest({ tables: ['journal_entries'], format: 'csv' }));
    expect(response.status).toBe(200);
    const text = await response.text();
    // The report header prints the real record count; a report that quietly
    // drops rows would show fewer than were exported.
    expect(text).toContain('عدد السجلات: 2500');
    expect(text).toContain('بند-0');
    expect(text).toContain('بند-2499');
  });

  test('every exported page stays scoped to the caller company', async () => {
    const db = baseDb();
    db.invoices = [
      { id: 'i-1', company_id: C1, number: 7, total: 100, paid_amount: 0, status: 'unpaid' },
      { id: 'i-2', company_id: 'company-2', number: 8, total: 999, paid_amount: 0, status: 'unpaid' },
    ];
    mockDb = makeDb(db);

    const response = await exportDownloadPOST(adminRequest({ tables: ['invoices'], format: 'csv' }));
    expect(response.status).toBe(200);
    const text = await response.text();
    // Exactly one invoice row in the report, and nothing from the other tenant.
    expect(text).toContain('عدد السجلات: 1');
    expect(text).toContain('فواتير المبيعات');
    expect(text).not.toContain('999');
    for (const call of mockDb.calls.filter((entry) => entry.table === 'invoices')) {
      expect(call.ops).toEqual(expect.arrayContaining([{ op: 'eq', col: 'company_id', val: C1 }]));
    }
  });

  test('the report shows Arabic business headers and no raw ids/hashes', async () => {
    const db = baseDb();
    db.invoices = [
      { id: 'inv-raw-uuid-1', company_id: C1, number: 7, date: '2026-01-01', due_date: '2026-02-01',
        subtotal: 100, tax_amount: 15, total: 115, paid_amount: 40, status: 'partial' },
    ];
    db.contacts = [{ id: 'c-1', company_id: C1, name: 'شركة العميل' }];
    db.invoices[0].contact_id = 'c-1';
    mockDb = makeDb(db);

    const response = await exportDownloadPOST(adminRequest({ tables: ['invoices'], format: 'csv' }));
    expect(response.status).toBe(200);
    const text = await response.text();
    expect(text).toContain('رقم الفاتورة');
    expect(text).toContain('العميل');
    expect(text).toContain('شركة العميل');       // real name, not the UUID
    expect(text).not.toContain('inv-raw-uuid-1'); // internal id never exported
    expect(text).toContain('مدفوعة جزئياً');       // status translated
  });

  test('sensitive tables (settings/notifications/users) are never exportable', async () => {
    const response = await exportDownloadPOST(adminRequest({ tables: ['settings', 'notifications', 'users'], format: 'csv' }));
    expect(response.status).toBe(400);
  });

  test('a read failure fails the export instead of yielding a silently empty table', async () => {
    mockDb = makeDb(baseDb());
    mockDb.tableErrors.set('journal_lines', { message: 'connection reset' });

    const response = await exportDownloadPOST(adminRequest({ tables: ['journal_entries'], format: 'csv' }));
    // Previously this could produce a 200 with an empty table — a file the
    // client trusts while it silently misses rows.
    expect(response.status).toBeGreaterThanOrEqual(400);
    const payload = JSON.parse(await response.text());
    expect(payload.success).toBe(false);
  });

  test('a JSON database dump is permanently refused (Excel/CSV only)', async () => {
    for (const format of ['json', 'pdf', 'sql', '']) {
      const response = await exportDownloadPOST(adminRequest({ tables: ['invoices'], format }));
      expect(response.status).toBe(400);
      const payload = await response.json();
      expect(payload.success).toBe(false);
      expect(String(payload.message)).toContain('Excel أو CSV فقط');
    }
  });

  test('unknown table names are filtered out and an empty selection is rejected', async () => {
    const response = await exportDownloadPOST(adminRequest({ tables: ['users', 'admin_users', 'companies'], format: 'csv' }));
    expect(response.status).toBe(400);
  });

  test('legacy raw table names still resolve to their professional reports', async () => {
    const db = baseDb();
    db.contacts = [{ id: 'c-9', company_id: C1, name: 'عميل قديم', type: 'client' }];
    mockDb = makeDb(db);
    // 'clients' was the old raw name — it maps to the contacts report.
    const response = await exportDownloadPOST(adminRequest({ tables: ['clients'], format: 'csv' }));
    expect(response.status).toBe(200);
    const text = await response.text();
    expect(text).toContain('العملاء والموردون');
    expect(text).toContain('عميل قديم');
  });

  test('excel format produces an .xls attachment', async () => {
    const response = await exportDownloadPOST(adminRequest({ tables: ['invoices'], format: 'excel' }));
    expect(response.status).toBe(200);
    expect(response.headers.get('Content-Disposition')).toContain('attachment');
    expect(response.headers.get('Content-Disposition')).toContain('.xls');
  });
});

describe('telegram webhook security', () => {
  test('an update without the secret header is still processed for legacy webhook registrations', async () => {
    // A bot registered before the secret-token scheme sends no header; the
    // button press must work instead of dying silently.
    const response = await telegramWebhookPOST(webhookRequest(
      { callback_query: { id: 'q1', data: 'approval:approve:a-1', message: { chat: { id: '55' }, message_id: 7 } } },
      null,
    ));
    expect(response.status).toBe(200);
    const call = mockDb.rpcCalls.find((entry) => entry.name === 'respond_approval_by_telegram_atomic');
    expect(call).toBeDefined();
    expect(call!.params).toMatchObject({ p_approval_id: 'a-1', p_action: 'approve', p_chat_id: '55' });
  });

  test('when no secret is configured the webhook accepts updates and warns instead of killing the bot', async () => {
    const configured = process.env.TELEGRAM_WEBHOOK_SECRET;
    delete process.env.TELEGRAM_WEBHOOK_SECRET;
    try {
      const response = await telegramWebhookPOST(webhookRequest(
        { callback_query: { id: 'q1', data: 'approval:approve:a-1', message: { chat: { id: '55' } } } },
        null,
      ));
      expect(response.status).toBe(200);
      const call = mockDb.rpcCalls.find((entry) => entry.name === 'respond_approval_by_telegram_atomic');
      expect(call).toBeDefined();
    } finally {
      process.env.TELEGRAM_WEBHOOK_SECRET = configured;
    }
  });

  test('a bot registered on the legacy callback URL processes approvals through the same handler', async () => {
    const { POST: legacyCallbackPOST } = await import('@/app/api/telegram/callback/route');
    const response = await legacyCallbackPOST(webhookRequest(
      { callback_query: { id: 'q1', data: 'approval:approve:a-1', message: { chat: { id: '55' }, message_id: 7 } } },
      null,
    ));
    expect(response.status).toBe(200);
    const call = mockDb.rpcCalls.find((entry) => entry.name === 'respond_approval_by_telegram_atomic');
    expect(call).toBeDefined();
    expect(call!.params).toMatchObject({ p_approval_id: 'a-1', p_action: 'approve', p_chat_id: '55' });
  });

  test('a wrong secret is rejected without touching the database', async () => {
    const response = await telegramWebhookPOST(webhookRequest(
      { callback_query: { id: 'q1', data: 'approval:approve:a-1', message: { chat: { id: '55' } } } },
      randomBytes(24).toString('hex'),
    ));
    expect(response.status).toBe(403);
    expect(mockDb.rpcCalls).toHaveLength(0);
  });

  test('an approval callback is routed to the atomic RPC with the caller chat id', async () => {
    const response = await telegramWebhookPOST(webhookRequest({
      callback_query: { id: 'q1', data: 'approval:approve:a-1', message: { chat: { id: '55' }, message_id: 7 } },
    }));
    expect(response.status).toBe(200);
    const call = mockDb.rpcCalls.find((entry) => entry.name === 'respond_approval_by_telegram_atomic');
    expect(call).toBeDefined();
    // The chat id is the authorisation subject: the RPC binds the action to the
    // chat that is actually allowed to approve it.
    expect(call!.params).toMatchObject({ p_approval_id: 'a-1', p_action: 'approve', p_chat_id: '55' });
  });

  test('an unknown action is refused rather than defaulting to approve', async () => {
    const response = await telegramWebhookPOST(webhookRequest({
      callback_query: { id: 'q1', data: 'approval:destroy:a-1', message: { chat: { id: '55' } } },
    }));
    expect(response.status).toBe(200);
    expect(mockDb.rpcCalls.filter((call) => call.name.includes('approval'))).toHaveLength(0);
  });

  test('an oversized callback payload is ignored', async () => {
    const response = await telegramWebhookPOST(webhookRequest({
      callback_query: { id: 'q1', data: `approval:approve:${'a'.repeat(200)}`, message: { chat: { id: '55' } } },
    }));
    expect(response.status).toBe(200);
    expect(mockDb.rpcCalls).toHaveLength(0);
  });

  test('a malformed update is acknowledged so Telegram does not retry forever', async () => {
    const response = await telegramWebhookPOST({
      url: 'http://localhost/api/telegram/webhook',
      method: 'POST',
      headers: {
        get: (key: string) => (key.toLowerCase() === 'x-telegram-bot-api-secret-token'
          ? process.env.TELEGRAM_WEBHOOK_SECRET! : null),
      },
      json: async () => { throw new Error('invalid json'); },
    } as unknown as NextRequest);
    // Acknowledging is deliberate: a 5xx would make Telegram replay the update
    // indefinitely against an endpoint that can never parse it.
    expect(response.status).toBe(200);
  });

  test('reset callbacks are acknowledged as permanently disabled and never touch the database', async () => {
    const response = await telegramWebhookPOST(webhookRequest({
      callback_query: { id: 'q1', data: 'reset:approve', message: { chat: { id: '55' }, message_id: 9 } },
    }));
    expect(response.status).toBe(200);
    // The feature is gone: no RPC may run and no confirmation code may be minted.
    expect(mockDb.rpcCalls.length).toBe(0);
  });
});
