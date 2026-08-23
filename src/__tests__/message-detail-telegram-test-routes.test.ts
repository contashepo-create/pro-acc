/**
 * Route-boundary tests for /api/messages/[id] (read/mark-read/archive)
 * and /api/settings/telegram/test (interactive link test runs).
 */
process.env.TOKEN_SECRET = 'test-secret-key-for-unit-tests-32chars!';
import { createToken } from '@/lib/auth';

type Row = Record<string, unknown>;
type Op = { op: string; col?: string; val?: unknown };

function makeDb(db: Record<string, Row[]>) {
  const calls: Array<{ table: string; ops: Op[] }> = [];
  const rpcResults = new Map<string, { data: unknown; error?: unknown } | null>();
  const from = (table: string) => {
    const ops: Op[] = [];
    calls.push({ table, ops });
    const rows = () =>
      (db[table] || []).filter((r) =>
        ops.every((o) => {
          if (o.op === 'eq') return r[o.col!] === o.val;
          if (o.op === 'in') return (o.val as unknown[]).includes(r[o.col!]);
          return true;
        })
      );
    const api: TestBuilder = {
      select: () => api,
      eq: (col: string, val: unknown) => { ops.push({ op: 'eq', col, val }); return api; },
      in: (col: string, val: unknown) => { ops.push({ op: 'in', col, val }); return api; },
      order: () => api, limit: () => api, range: () => api, is: () => api, neq: () => api,
      or: () => api, lt: () => api, gte: () => api, lte: () => api,
      insert: () => api, update: () => api, delete: () => api,
      maybeSingle: async () => ({ data: rows()[0] || null, error: null }),
      single: async () => ({ data: rows()[0] || null, error: rows()[0] ? null : { message: 'not found' } }),
      then: <T1 = { data: unknown; error: unknown; count?: number }, T2 = never>(
        ok?: ((v: { data: unknown; error: unknown; count?: number }) => T1 | PromiseLike<T1>) | null,
        fail?: ((e: unknown) => T2 | PromiseLike<T2>) | null,
      ) => Promise.resolve({ data: rows(), error: null, count: rows().length }).then(ok ?? undefined, fail ?? undefined),
    };
    return api;
  };
  return {
    from, calls, rpcResults,
    rpc: async (name: string) => rpcResults.get(name) || { data: null, error: null },
  };
}

let mockDb: ReturnType<typeof makeDb>;
jest.mock('@/lib/supabase-client', () => ({ getSupabase: () => mockDb }));

import { GET as messageGET, PATCH as messagePATCH, DELETE as messageDELETE } from '@/app/api/messages/[id]/route';
import type { TestBuilder } from './mocks';
import type { NextRequest } from 'next/server';
import { GET as tgTestGET, POST as tgTestPOST } from '@/app/api/settings/telegram/test/route';
import { resetRateLimits } from '@/lib/memory-rate-limit';

const C1 = 'company-1';
const MID = '00000000-0000-4000-8000-00000000b001';

function req(role = 'admin', method = 'GET', url = 'http://localhost/x', body?: Row) {
  const token = createToken('u1', role, 0);
  return { url, method, nextUrl: new URL(url), headers: { get: (k: string) => k === 'authorization' ? `Bearer ${token}` : null },
    cookies: { get: () => undefined }, json: async () => body } as unknown as NextRequest;
}

function baseDb() {
  return {
    users: [{ id: 'u1', company_id: C1, is_active: true, token_version: 0, role: 'admin' }],
    companies: [{ id: C1, is_active: true }],
    subscriptions: [{ id: 's1', company_id: C1, status: 'active', end_date: '2099-01-01', plan_code: 'enterprise',
      subscription_plans: { code: 'enterprise', features_modules: { messages: true, telegram_integration: true } } }],
    messages: [], telegram_test_runs: [], audit_log: [],
  } as Record<string, Row[]>;
}

beforeEach(() => { resetRateLimits(); mockDb = makeDb(baseDb()); });

describe('messages/[id] GET', () => {
  test('returns a tenant message', async () => {
    mockDb = makeDb({ ...baseDb(), messages: [{ id: MID, company_id: C1, sender_id: 'u1', subject: 's', body: 'b', is_read: false }] });
    const res = await messageGET(req('admin', 'GET', `http://localhost/api/messages/${MID}`), { params: Promise.resolve({ id: MID }) });
    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.data.subject).toBe('s');
  });

  test('rejects an invalid id and returns 404 for unknown message', async () => {
    const res1 = await messageGET(req('admin', 'GET', 'http://localhost/x'), { params: Promise.resolve({ id: 'bad' }) });
    expect(res1.status).toBe(400);
    const res2 = await messageGET(req('admin', 'GET', `http://localhost/x/${MID}`), { params: Promise.resolve({ id: MID }) });
    expect(res2.status).toBe(404);
  });
});

describe('messages/[id] PATCH', () => {
  test('marks a message read via RPC', async () => {
    mockDb.rpcResults.set('mark_company_message_read_atomic', { data: true, error: null });
    const res = await messagePATCH(req('admin', 'PATCH', `http://localhost/api/messages/${MID}`), { params: Promise.resolve({ id: MID }) });
    expect(res.status).toBe(200);
  });

  test('rejects an invalid id', async () => {
    const res = await messagePATCH(req('admin', 'PATCH', 'http://localhost/x'), { params: Promise.resolve({ id: 'bad' }) });
    expect(res.status).toBe(400);
  });

  test('maps not-found (404) and outbound (409) RPC errors', async () => {
    mockDb.rpcResults.set('mark_company_message_read_atomic', { data: null, error: { message: 'الرسالة غير موجودة' } });
    const res1 = await messagePATCH(req('admin', 'PATCH', `http://localhost/x/${MID}`), { params: Promise.resolve({ id: MID }) });
    expect(res1.status).toBe(404);
    mockDb.rpcResults.set('mark_company_message_read_atomic', { data: null, error: { message: 'رسالة صادرة' } });
    const res2 = await messagePATCH(req('admin', 'PATCH', `http://localhost/x/${MID}`), { params: Promise.resolve({ id: MID }) });
    expect(res2.status).toBe(409);
  });
});

describe('messages/[id] DELETE', () => {
  test('archives a message via RPC', async () => {
    mockDb.rpcResults.set('archive_company_message_atomic', { data: true, error: null });
    const res = await messageDELETE(req('admin', 'DELETE', `http://localhost/api/messages/${MID}`), { params: Promise.resolve({ id: MID }) });
    expect(res.status).toBe(200);
  });

  test('rejects an invalid id', async () => {
    const res = await messageDELETE(req('admin', 'DELETE', 'http://localhost/x'), { params: Promise.resolve({ id: 'bad' }) });
    expect(res.status).toBe(400);
  });

  test('maps not-found RPC error to 404', async () => {
    mockDb.rpcResults.set('archive_company_message_atomic', { data: null, error: { message: 'غير موجود' } });
    const res = await messageDELETE(req('admin', 'DELETE', `http://localhost/x/${MID}`), { params: Promise.resolve({ id: MID }) });
    expect(res.status).toBe(404);
  });
});

describe('settings/telegram/test GET', () => {
  test('returns a test run for the caller', async () => {
    mockDb = makeDb({ ...baseDb(), telegram_test_runs: [{ id: MID, company_id: C1, created_by: 'u1', status: 'pending', updated_at: '2026-01-01' }] });
    const res = await tgTestGET(req('admin', 'GET', `http://localhost/api/settings/telegram/test?test_run_id=${MID}`));
    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.data.status).toBe('pending');
  });

  test('rejects an invalid test_run_id and returns 404 when missing', async () => {
    const res1 = await tgTestGET(req('admin', 'GET', 'http://localhost/api/settings/telegram/test?test_run_id=bad'));
    expect(res1.status).toBe(400);
    const res2 = await tgTestGET(req('admin', 'GET', `http://localhost/api/settings/telegram/test?test_run_id=${MID}`));
    expect(res2.status).toBe(404);
  });
});

describe('settings/telegram/test POST', () => {
  test('returns 502 when the bot token is not configured', async () => {
    delete process.env.TELEGRAM_BOT_TOKEN;
    mockDb.rpcResults.set('create_telegram_test_run_atomic', { data: { id: MID, chat_id: '12345' }, error: null });
    mockDb.rpcResults.set('expire_telegram_test_run_atomic', { data: null, error: null });
    const res = await tgTestPOST(req('admin', 'POST', 'http://localhost/api/settings/telegram/test'));
    expect(res.status).toBe(502);
  });

  test('rejects when the RPC reports telegram not configured (400)', async () => {
    mockDb.rpcResults.set('create_telegram_test_run_atomic', { data: null, error: { message: 'تيليجرام غير مفعلة' } });
    const res = await tgTestPOST(req('admin', 'POST', 'http://localhost/api/settings/telegram/test'));
    expect(res.status).toBe(400);
  });

  test('rejects when a test is already running (409)', async () => {
    mockDb.rpcResults.set('create_telegram_test_run_atomic', { data: null, error: { message: 'فحص قيد التنفيذ' } });
    const res = await tgTestPOST(req('admin', 'POST', 'http://localhost/api/settings/telegram/test'));
    expect(res.status).toBe(409);
  });

  test('sends the interactive message and returns 201 when telegram succeeds', async () => {
    process.env.TELEGRAM_BOT_TOKEN = 'bot-token';
    const fetchMock = jest.spyOn(globalThis as { fetch: typeof fetch }, 'fetch').mockResolvedValue({
      ok: true, status: 200, json: async () => ({ ok: true }),
    } as unknown as Response);
    try {
      mockDb.rpcResults.set('create_telegram_test_run_atomic', { data: { id: MID, chat_id: '12345' }, error: null });
      const res = await tgTestPOST(req('admin', 'POST', 'http://localhost/api/settings/telegram/test'));
      expect(res.status).toBe(201);
    } finally {
      fetchMock.mockRestore();
    }
  });

  test('returns 502 when the telegram HTTP call fails', async () => {
    process.env.TELEGRAM_BOT_TOKEN = 'bot-token';
    const fetchMock = jest.spyOn(globalThis as { fetch: typeof fetch }, 'fetch').mockResolvedValue({
      ok: false, status: 400, json: async () => ({ ok: false, description: 'bad request' }),
    } as unknown as Response);
    try {
      mockDb.rpcResults.set('create_telegram_test_run_atomic', { data: { id: MID, chat_id: '12345' }, error: null });
      mockDb.rpcResults.set('expire_telegram_test_run_atomic', { data: null, error: null });
      const res = await tgTestPOST(req('admin', 'POST', 'http://localhost/api/settings/telegram/test'));
      expect(res.status).toBe(502);
    } finally {
      fetchMock.mockRestore();
    }
  });
});
