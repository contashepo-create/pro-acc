/**
 * Route-boundary tests for company identity + GDPR data-portability routes:
 * /api/company/logo, /api/company/data-export, /api/company/data-export/[id]/download,
 * and /api/contracts/[id]/documents/[documentId].
 */
process.env.TOKEN_SECRET = 'test-secret-key-for-unit-tests-32chars!';
import { createToken } from '@/lib/auth';
import type { TestBuilder } from './mocks';
import type { NextRequest } from 'next/server';

type Row = Record<string, unknown>;
type Op = { op: string; col?: string; val?: unknown };

function makeDb(db: Record<string, Row[]>) {
  const calls: Array<{ table: string; ops: Op[] }> = [];
  const rpcResults = new Map<string, { data: unknown; error: unknown }>();
  const from = (table: string) => {
    const ops: Op[] = [];
    calls.push({ table, ops });
    const rows = () =>
      (db[table] || []).filter((r) =>
        ops.every((o) => {
          if (o.op === 'eq') return r[o.col!] === o.val;
          if (o.op === 'in') return (o.val as unknown[]).includes(r[o.col!]);
          if (o.op === 'lt') return String(r[o.col!]) < String(o.val);
          if (o.op === 'gte') return String(r[o.col!]) >= String(o.val);
          if (o.op === 'lte') return String(r[o.col!]) <= String(o.val);
          return true;
        })
      );
    const api: TestBuilder = {
      select: () => api,
      eq: (col: string, val: unknown) => { ops.push({ op: 'eq', col, val }); return api; },
      in: (col: string, val: unknown) => { ops.push({ op: 'in', col, val }); return api; },
      order: () => api, limit: () => api, range: () => api, is: () => api, neq: () => api,
      or: () => api, lt: (col: string, val: unknown) => { ops.push({ op: 'lt', col, val }); return api; },
      gte: (col: string, val: unknown) => { ops.push({ op: 'gte', col, val }); return api; },
      lte: (col: string, val: unknown) => { ops.push({ op: 'lte', col, val }); return api; },
      insert: (payload: Row | Row[]) => { db[table] = [...(db[table] || []), ...(Array.isArray(payload) ? payload : [payload])]; return api; },
      update: () => api, delete: () => api,
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
    storage: {
      from: () => ({
        upload: async () => ({ error: null }),
        remove: async () => ({ error: null }),
        createSignedUrl: async () => ({ data: { signedUrl: 'https://signed.example.com/object' }, error: null }),
      }),
    },
  };
}

let mockDb: ReturnType<typeof makeDb>;
jest.mock('@/lib/supabase-client', () => ({ getSupabase: () => mockDb }));

import { GET as logoGET, POST as logoPOST } from '@/app/api/company/logo/route';
import { GET as exportGET, POST as exportPOST } from '@/app/api/company/data-export/route';
import { GET as downloadGET } from '@/app/api/company/data-export/[id]/download/route';
import { GET as contractDocGET } from '@/app/api/contracts/[id]/documents/[documentId]/route';
import { resetRateLimits } from '@/lib/memory-rate-limit';

const C1 = 'company-1';
const EXPORT_ID = '00000000-0000-4000-8000-00000000c001';
const CID = '00000000-0000-4000-8000-00000000c0a1';
const DOC_ID = '00000000-0000-4000-8000-00000000c0b1';

function req(role = 'admin', method = 'GET', url = 'http://localhost/x', body?: Row) {
  const token = createToken('u1', role, 0);
  return { url, method, nextUrl: new URL(url), headers: { get: (k: string) => k === 'authorization' ? `Bearer ${token}` : null },
    cookies: { get: () => undefined }, json: async () => body } as unknown as NextRequest;
}

function baseDb() {
  return {
    users: [{ id: 'u1', company_id: C1, is_active: true, token_version: 0, role: 'admin' }],
    companies: [{ id: C1, is_active: true, logo_url: null, name: 'شركة' }],
    subscriptions: [{ id: 's1', company_id: C1, status: 'active', end_date: '2099-01-01', plan_code: 'enterprise',
      subscription_plans: { code: 'enterprise', features_modules: {} } }],
    audit_log: [], company_data_exports: [], contract_documents: [],
  } as Record<string, Row[]>;
}

beforeEach(() => { resetRateLimits(); mockDb = makeDb(baseDb()); });

describe('company/logo', () => {
  test('GET returns the company logo url and name', async () => {
    const res = await logoGET(req('admin', 'GET', 'http://localhost/api/company/logo'));
    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.data.name).toBe('شركة');
  });

  test('POST updates the logo url and writes an audit log', async () => {
    const res = await logoPOST(req('admin', 'POST', 'http://localhost/api/company/logo', { logo_url: 'https://cdn.example.com/logo.png' }));
    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.data.logo_url).toBe('https://cdn.example.com/logo.png');
    expect(mockDb.calls.some((c) => c.table === 'audit_log')).toBe(true);
  });

  test('POST rejects a non-HTTPS logo url', async () => {
    const res = await logoPOST(req('admin', 'POST', 'http://localhost/api/company/logo', { logo_url: 'javascript:alert(1)' }));
    expect(res.status).toBe(400);
  });

  test('POST denies non-admin (DB role authoritative)', async () => {
    mockDb = makeDb({ ...baseDb(), users: [{ id: 'u1', company_id: C1, is_active: true, token_version: 0, role: 'manager' }] });
    const res = await logoPOST(req('manager', 'POST', 'http://localhost/api/company/logo', { logo_url: 'https://cdn.example.com/logo.png' }));
    expect(res.status).toBe(403);
  });
});

describe('company/data-export GET', () => {
  test('lists exports for the company admin', async () => {
    const ready = new Date(Date.now() + 86400000).toISOString();
    mockDb = makeDb({ ...baseDb(), company_data_exports: [
      { id: EXPORT_ID, company_id: C1, status: 'ready', requested_at: new Date().toISOString(), completed_at: new Date().toISOString(), expires_at: ready, file_size_bytes: 10, error_message: null, download_url: 'storage:company-exports/c1/x.json' },
      { id: 'e2', company_id: C1, status: 'processing', requested_at: new Date().toISOString(), completed_at: null, expires_at: null, file_size_bytes: 0, error_message: null, download_url: null },
    ] });
    const res = await exportGET(req('admin', 'GET', 'http://localhost/api/company/data-export'));
    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.data.exports).toHaveLength(2);
    expect(json.data.exports[0].has_file).toBe(true);
  });

  test('marks an expired ready export as expired', async () => {
    const past = new Date(Date.now() - 100000).toISOString();
    mockDb = makeDb({ ...baseDb(), company_data_exports: [
      { id: EXPORT_ID, company_id: C1, status: 'ready', requested_at: new Date().toISOString(), expires_at: past, file_size_bytes: 10, error_message: null, download_url: 'storage:company-exports/c1/x.json' },
    ] });
    const res = await exportGET(req('admin', 'GET', 'http://localhost/api/company/data-export'));
    const json = await res.json();
    expect(json.data.exports[0].status).toBe('expired');
    expect(json.data.exports[0].has_file).toBe(false);
  });

  test('denies non-admin', async () => {
    mockDb = makeDb({ ...baseDb(), users: [{ id: 'u1', company_id: C1, is_active: true, token_version: 0, role: 'accountant' }] });
    const res = await exportGET(req('accountant', 'GET', 'http://localhost/api/company/data-export'));
    expect(res.status).toBe(403);
  });
});

describe('company/data-export POST', () => {
  test('creates a pending export and enqueues generation', async () => {
    const res = await exportPOST(req('admin', 'POST', 'http://localhost/api/company/data-export'));
    expect(res.status).toBe(201);
    const json = await res.json();
    expect(json.data.export.status).toBe('pending');
  });

  test('conflicts when an export is already pending (409)', async () => {
    mockDb = makeDb({ ...baseDb(), company_data_exports: [
      { id: 'e1', company_id: C1, status: 'processing', requested_at: new Date().toISOString() },
    ] });
    const res = await exportPOST(req('admin', 'POST', 'http://localhost/api/company/data-export'));
    expect(res.status).toBe(409);
  });

  test('rate-limits to 3 exports per 24h (429)', async () => {
    const now = new Date().toISOString();
    mockDb = makeDb({ ...baseDb(), company_data_exports: [
      { id: 'e1', company_id: C1, status: 'ready', requested_at: now },
      { id: 'e2', company_id: C1, status: 'ready', requested_at: now },
      { id: 'e3', company_id: C1, status: 'ready', requested_at: now },
    ] });
    const res = await exportPOST(req('admin', 'POST', 'http://localhost/api/company/data-export'));
    expect(res.status).toBe(429);
  });
});

describe('company/data-export/[id]/download GET', () => {
  test('rejects an invalid id', async () => {
    const res = await downloadGET(req('admin', 'GET', 'http://localhost/x'), { params: Promise.resolve({ id: 'bad' }) });
    expect(res.status).toBe(400);
  });

  test('returns 404 for an unknown export', async () => {
    const res = await downloadGET(req('admin', 'GET', 'http://localhost/x'), { params: Promise.resolve({ id: EXPORT_ID }) });
    expect(res.status).toBe(404);
  });

  test('returns 409 when the file is not ready yet', async () => {
    mockDb = makeDb({ ...baseDb(), company_data_exports: [{ id: EXPORT_ID, company_id: C1, status: 'pending', download_url: null, expires_at: null }] });
    const res = await downloadGET(req('admin', 'GET', 'http://localhost/x'), { params: Promise.resolve({ id: EXPORT_ID }) });
    expect(res.status).toBe(409);
  });

  test('returns 410 when the download has expired', async () => {
    const past = new Date(Date.now() - 100000).toISOString();
    mockDb = makeDb({ ...baseDb(), company_data_exports: [{ id: EXPORT_ID, company_id: C1, status: 'ready', download_url: 'storage:company-exports/c1/x.json', expires_at: past }] });
    const res = await downloadGET(req('admin', 'GET', 'http://localhost/x'), { params: Promise.resolve({ id: EXPORT_ID }) });
    expect(res.status).toBe(410);
  });

  test('streams the storage object as a download', async () => {
    const future = new Date(Date.now() + 86400000).toISOString();
    mockDb = makeDb({ ...baseDb(), company_data_exports: [{ id: EXPORT_ID, company_id: C1, status: 'ready', download_url: `storage:company-exports/${C1}/${EXPORT_ID}.json`, expires_at: future }] });
    const fetchMock = jest.spyOn(globalThis as { fetch: typeof fetch }, 'fetch').mockResolvedValue({
      ok: true, body: '{}', headers: { get: () => '2' },
    } as unknown as Response);
    try {
      const res = await downloadGET(req('admin', 'GET', 'http://localhost/x'), { params: Promise.resolve({ id: EXPORT_ID }) });
      expect(res.status).toBe(200);
      expect(res.headers.get('Content-Disposition')).toContain('pro-acc-export');
    } finally {
      fetchMock.mockRestore();
    }
  });

  test('rejects an unsafe object path (500)', async () => {
    const future = new Date(Date.now() + 86400000).toISOString();
    mockDb = makeDb({ ...baseDb(), company_data_exports: [{ id: EXPORT_ID, company_id: C1, status: 'ready', download_url: 'storage:company-exports/../../etc/passwd', expires_at: future }] });
    const res = await downloadGET(req('admin', 'GET', 'http://localhost/x'), { params: Promise.resolve({ id: EXPORT_ID }) });
    expect(res.status).toBe(500);
  });

  test('streams a legacy base64 data-url export', async () => {
    const future = new Date(Date.now() + 86400000).toISOString();
    const payload = Buffer.from('{"ok":true}').toString('base64');
    mockDb = makeDb({ ...baseDb(), company_data_exports: [{ id: EXPORT_ID, company_id: C1, status: 'ready', download_url: `data:application/json;base64,${payload}`, expires_at: future }] });
    const res = await downloadGET(req('admin', 'GET', 'http://localhost/x'), { params: Promise.resolve({ id: EXPORT_ID }) });
    expect(res.status).toBe(200);
  });
});

describe('contracts/[id]/documents/[documentId] GET', () => {
  test('rejects an invalid id or document id', async () => {
    const res = await contractDocGET(req('admin', 'GET', 'http://localhost/x'), { params: Promise.resolve({ id: 'bad', documentId: DOC_ID }) });
    expect(res.status).toBe(400);
  });

  test('returns 404 for an unknown document', async () => {
    const res = await contractDocGET(req('admin', 'GET', 'http://localhost/x'), { params: Promise.resolve({ id: CID, documentId: DOC_ID }) });
    expect(res.status).toBe(404);
  });

  test('returns 410 for a legacy inline document reference', async () => {
    mockDb = makeDb({ ...baseDb(), contract_documents: [{ id: DOC_ID, contract_id: CID, company_id: C1, file_data: 'data:application/pdf;base64,x', filename: 'doc.pdf', content_type: 'application/pdf' }] });
    const res = await contractDocGET(req('admin', 'GET', 'http://localhost/x'), { params: Promise.resolve({ id: CID, documentId: DOC_ID }) });
    expect(res.status).toBe(410);
  });

  test('rejects an unsafe object path (500)', async () => {
    mockDb = makeDb({ ...baseDb(), contract_documents: [{ id: DOC_ID, contract_id: CID, company_id: C1, file_data: 'storage:contract-documents/../../etc/passwd', filename: 'doc.pdf', content_type: 'application/pdf' }] });
    const res = await contractDocGET(req('admin', 'GET', 'http://localhost/x'), { params: Promise.resolve({ id: CID, documentId: DOC_ID }) });
    expect(res.status).toBe(500);
  });

  test('streams a stored document', async () => {
    mockDb = makeDb({ ...baseDb(), contract_documents: [{ id: DOC_ID, contract_id: CID, company_id: C1, file_data: `storage:contract-documents/${C1}/${CID}/a.pdf`, filename: 'doc.pdf', content_type: 'application/pdf' }] });
    const fetchMock = jest.spyOn(globalThis, 'fetch').mockResolvedValue({
      ok: true, body: '%PDF-1.4', headers: { get: () => '10' },
    } as unknown as Response);
    try {
      const res = await contractDocGET(req('admin', 'GET', 'http://localhost/x'), { params: Promise.resolve({ id: CID, documentId: DOC_ID }) });
      expect(res.status).toBe(200);
      expect(res.headers.get('Content-Type')).toBe('application/pdf');
      expect(res.headers.get('X-Content-Type-Options')).toBe('nosniff');
    } finally {
      fetchMock.mockRestore();
    }
  });
});
