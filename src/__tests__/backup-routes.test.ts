/**
 * Route-boundary tests for /api/backup/* : auto (status + trigger), download
 * (json/csv/excel), upload (apply a backup), and validate (dry-run).
 */
process.env.TOKEN_SECRET = 'test-secret-key-for-unit-tests-32chars!';
import { createToken } from '@/lib/auth';
import { createHmac } from 'crypto';
import type { TestBuilder } from './mocks';
import type { NextRequest } from 'next/server';

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
  };
}

let mockDb: ReturnType<typeof makeDb>;
jest.mock('@/lib/supabase-client', () => ({ getSupabase: () => mockDb }));

import { GET as autoGET, POST as autoPOST } from '@/app/api/backup/auto/route';
import { GET as downloadGET } from '@/app/api/backup/download/route';
import { POST as uploadPOST } from '@/app/api/backup/upload/route';
import { POST as validatePOST } from '@/app/api/backup/validate/route';
import { resetRateLimits } from '@/lib/memory-rate-limit';

const C1 = 'company-1';
const UID = '00000000-0000-4000-8000-0000000000a1';

function req(role = 'admin', method = 'GET', url = 'http://localhost/x', body?: Row) {
  const token = createToken('u1', role, 0);
  return { url, method, nextUrl: new URL(url), headers: { get: (k: string) => k === 'authorization' ? `Bearer ${token}` : null },
    cookies: { get: () => undefined }, json: async () => body, text: async () => JSON.stringify(body) } as unknown as NextRequest;
}

function baseDb() {
  return {
    users: [{ id: 'u1', company_id: C1, is_active: true, token_version: 0, role: 'admin' }],
    companies: [{ id: C1, is_active: true, name: 'شركة', email: 'admin@example.com', phone: '123' }],
    subscriptions: [{ id: 's1', company_id: C1, status: 'active', end_date: '2099-01-01', plan_code: 'enterprise',
      subscription_plans: { code: 'enterprise', features_modules: {} } }],
    audit_log: [], backup_logs: [], security_audit_log: [], login_attempts: [],
    accounts: [], invoices: [], contacts: [], journal_entries: [], journal_lines: [],
    cash_transactions: [], clients: [], projects: [], banks_safes: [], inventory_items: [],
    employees: [], payroll: [], invoice_items: [],
  } as Record<string, Row[]>;
}

beforeEach(() => { resetRateLimits(); mockDb = makeDb(baseDb()); });

describe('backup/auto GET', () => {
  test('returns backup history and data summary', async () => {
    mockDb = makeDb({ ...baseDb(), audit_log: [{ id: 'l1', company_id: C1, action: 'auto_backup', created_at: '2026-01-01' }] });
    const res = await autoGET(req('admin', 'GET', 'http://localhost/api/backup/auto'));
    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.data.backups).toHaveLength(1);
    expect(json.data.lastBackup).toBe('2026-01-01');
    expect(json.data.dataSummary).toHaveProperty('invoices');
  });
});

describe('backup/auto POST', () => {
  test('exports all company data and reports stats', async () => {
    const res = await autoPOST(req('admin', 'POST', 'http://localhost/api/backup/auto'));
    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.data.tablesExported).toBeGreaterThan(10);
    expect(json.data.backupUrl).toBe('/api/backup/download');
  });
});

describe('backup/download GET', () => {
  test('returns json with integrity headers', async () => {
    const res = await downloadGET(req('admin', 'GET', 'http://localhost/api/backup/download?format=json'));
    expect(res.status).toBe(200);
    expect(res.headers.get('X-Backup-Hash')).toBeTruthy();
    expect(res.headers.get('X-Backup-Signature')).toBeTruthy();
  });

  test('returns csv export for invoices', async () => {
    mockDb = makeDb({ ...baseDb(), invoices: [{ id: '11111111-1111-4111-8111-111111111111', company_id: C1, number: 'INV-1' }] });
    const res = await downloadGET(req('admin', 'GET', 'http://localhost/api/backup/download?format=csv'));
    expect(res.status).toBe(200);
    expect(res.headers.get('Content-Type')).toContain('text/csv');
  });

  test('returns excel mime for excel format', async () => {
    const res = await downloadGET(req('admin', 'GET', 'http://localhost/api/backup/download?format=excel'));
    expect(res.status).toBe(200);
    expect(res.headers.get('Content-Type')).toContain('spreadsheetml');
  });

});

describe('backup/validate POST', () => {
  const backupData = {
    metadata: { company_id: C1, email: 'admin@example.com' },
    data: { accounts: [{ id: UID, company_id: C1, code: '1000', name: 'حساب' }] },
  };
  const fullHmac = () => createHmac('sha256', process.env.TOKEN_SECRET!).update(JSON.stringify(backupData, null, 2)).digest('hex');
  const fileHash = () => fullHmac().substring(0, 16);

  test('validates a genuine backup', async () => {
    mockDb = makeDb({ ...baseDb(), backup_logs: [{ id: 'b1', company_id: C1, hmac_signature: fullHmac() }] });
    const res = await validatePOST(req('admin', 'POST', 'http://localhost/api/backup/validate', { backupData, fileHash: fileHash() }));
    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.data.valid).toBe(true);
  });

  test('rejects a backup with no matching provenance log', async () => {
    const res = await validatePOST(req('admin', 'POST', 'http://localhost/api/backup/validate', { backupData, fileHash: fileHash() }));
    expect(res.status).toBe(400);
  });

  test('rejects a wrong ownership company', async () => {
    const wrong = { metadata: { company_id: 'other' }, data: {} };
    const res = await validatePOST(req('admin', 'POST', 'http://localhost/api/backup/validate', { backupData: wrong, fileHash: 'x' }));
    expect(res.status).toBe(403);
  });

  test('rejects a missing payload', async () => {
    const res = await validatePOST(req('admin', 'POST', 'http://localhost/api/backup/validate', {}));
    expect(res.status).toBe(400);
  });
});

describe('backup/upload POST', () => {
  const backupData = {
    metadata: { company_id: C1, email: 'admin@example.com' },
    data: { accounts: [{ id: UID, company_id: C1, code: '1000', name: 'حساب' }] },
  };
  const fullHmac = () => createHmac('sha256', process.env.TOKEN_SECRET!).update(JSON.stringify(backupData, null, 2)).digest('hex');
  const fileHash = () => fullHmac().substring(0, 16);

  test('restores a genuine backup via the atomic RPC', async () => {
    mockDb = makeDb({ ...baseDb(), backup_logs: [{ id: 'b1', company_id: C1, hmac_signature: fullHmac() }] });
    mockDb.rpcResults.set('restore_company_backup_atomic', { data: { restored: 1 }, error: null });
    const res = await uploadPOST(req('admin', 'POST', 'http://localhost/api/backup/upload', { backupData, fileHash: fileHash() }));
    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.data.restoredTables).toContain('accounts');
  });

  test('rejects a backup with no provenance log', async () => {
    const res = await uploadPOST(req('admin', 'POST', 'http://localhost/api/backup/upload', { backupData, fileHash: fileHash() }));
    expect(res.status).toBe(400);
  });

  test('rejects a tampered signature', async () => {
    mockDb = makeDb({ ...baseDb(), backup_logs: [{ id: 'b1', company_id: C1, hmac_signature: fullHmac() }] });
    const res = await uploadPOST(req('admin', 'POST', 'http://localhost/api/backup/upload', { backupData, fileHash: 'deadbeefdeadbeef' }));
    expect(res.status).toBe(400);
  });
});
