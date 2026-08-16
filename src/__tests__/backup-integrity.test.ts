/**
 * Section 11 tests — Backup & restore
 *
 * Critical fixes covered:
 * 1. Download used requireApiAuth — ANY user (even supervisor) could export the
 *    full company dataset (accounts, journal, invoices, employees, payroll).
 *    Now admin-only.
 * 2. Upload (restore/overwrite) used requireApiAuth — ANY user could restore.
 *    Now admin-only.
 * Existing safeguards confirmed: company-id match, HMAC-against-download-log
 * anti-tamper, and cross-company row rejection.
 */

process.env.TOKEN_SECRET = 'test-secret-key-for-unit-tests-32chars!';

import { createHmac } from 'crypto';
import { createToken } from '@/lib/auth';

type Row = Record<string, any>;
type Op = { op: string; col?: string; val?: any };

function makeDb(db: Record<string, Row[]>) {
  const calls: Array<{ table: string; ops: Op[]; mut: { kind?: string; payload?: any } }> = [];
  const from = (table: string) => {
    const ops: Op[] = [];
    const mut: { kind?: string; payload?: any } = {};
    const call: any = { table, ops, mut };
    calls.push(call);
    const applyFilters = () =>
      (db[table] || []).filter((r) =>
        ops.every((o) => {
          if (o.op === 'eq') return r[o.col!] === o.val;
          if (o.op === 'neq') return r[o.col!] !== o.val;
          if (o.op === 'in') return (o.val as any[]).includes(r[o.col!]);
          if (o.op === 'is') return o.val === null ? r[o.col!] == null : r[o.col!] === o.val;
          return true;
        })
      );
    const api: any = {
      select: () => api,
      eq: (col: string, val: any) => { ops.push({ op: 'eq', col, val }); return api; },
      neq: () => api, in: () => api, is: () => api, or: () => api,
      gte: () => api, lte: () => api, order: () => api, limit: () => api,
      insert: (p: any) => { mut.kind = 'insert'; mut.payload = p; return api; },
      update: (p: any) => { mut.kind = 'update'; mut.payload = p; return api; },
      upsert: (p: any) => { mut.kind = 'upsert'; mut.payload = p; return api; },
      delete: () => { mut.kind = 'delete'; return api; },
      maybeSingle: async () => ({ data: applyFilters()[0] ?? null, error: null }),
      single: async () => {
        if (mut.kind === 'insert' || mut.kind === 'upsert') return { data: applyFilters()[0] ?? mut.payload, error: null };
        const row = applyFilters()[0] ?? null;
        return { data: row, error: row ? null : { message: 'not found' } };
      },
      then: (onF: any, onR: any) =>
        Promise.resolve({ data: applyFilters(), count: applyFilters().length, error: null }).then(onF, onR),
    };
    return api;
  };
  const db_: any = { from, calls, rpcCalls: [] as Array<{ name: string; params: any }> };
  db_.rpc = async (name: string, params: any) => {
    db_.rpcCalls.push({ name, params });
    return { data: { restored: true }, error: null };
  };
  return db_;
}

let mockDb: ReturnType<typeof makeDb>;
jest.mock('@/lib/supabase-client', () => ({ getSupabase: () => mockDb }));

import { GET as backupDownloadGET } from '@/app/api/backup/download/route';
import { POST as backupUploadPOST } from '@/app/api/backup/upload/route';

const C1 = 'company-1';
const C2 = 'company-2';

function baseDb() {
  return {
    users: [
      { id: 'u-admin', company_id: C1, name: 'مدير', role: 'admin', is_active: true, token_version: 0 },
      { id: 'u-sup', company_id: C1, name: 'مشرف', role: 'supervisor', is_active: true, token_version: 0 },
    ],
    companies: [{ id: C1, name: 'شركة', email: 'co@x.com', phone: '0500', is_active: true }],
    accounts: [{ id: 'a1', company_id: C1, code: '1130', name: 'العملاء' }],
    contacts: [{ id: 'c1', company_id: C1, name: 'عميل' }],
    employees: [{ id: 'e1', company_id: C1, name: 'موظف' }],
    subscriptions: [{
      id: 's1', company_id: C1, plan_id: 'p1', plan_code: 'start', status: 'active',
      start_date: '2024-01-01',
      end_date: new Date(Date.now() + 30 * 86400000).toISOString().split('T')[0],
      subscription_plans: { code: 'start', name: 'Start', features_modules: { dashboard: true } },
    }],
    backup_logs: [] as Row[],
    security_audit_log: [] as Row[],
  } as Record<string, Row[]>;
}

function authedAs(userId: string, role: string, body?: any, method = 'GET') {
  const token = createToken(userId, role);
  return {
    url: 'http://localhost/api/test',
    method,
    headers: { get: (k: string) => (k === 'authorization' ? `Bearer ${token}` : null) },
    cookies: { get: () => undefined },
    json: async () => body,
  } as any;
}
const insertsOf = (t: string) => mockDb.calls.filter((c) => c.mut.kind === 'insert' && c.table === t);
const upsertsOf = (t: string) => mockDb.calls.filter((c) => c.mut.kind === 'upsert' && c.table === t);

function sign(backupData: any) {
  const json = JSON.stringify(backupData, null, 2);
  return createHmac('sha256', process.env.TOKEN_SECRET!).update(json).digest('hex');
}

// ---------------------------------------------------------------------------

describe('backup download — admin-only', () => {
  test('supervisor cannot export company data', async () => {
    mockDb = makeDb(baseDb());
    const res = await backupDownloadGET(authedAs('u-sup', 'supervisor', undefined, 'GET'));
    expect(res.status).toBe(403);
    expect(insertsOf('backup_logs')).toHaveLength(0);
  });

  test('admin exports and the download is logged', async () => {
    mockDb = makeDb(baseDb());
    const res = await backupDownloadGET(authedAs('u-admin', 'admin', undefined, 'GET'));
    expect(res.status).toBe(200);
    // only this company's data is exported (tenant scoping on each table query)
    const accountsQuery = mockDb.calls.find((c) => c.table === 'accounts');
    expect(accountsQuery!.ops.some((o) => o.op === 'eq' && o.col === 'company_id' && o.val === C1)).toBe(true);
    expect(insertsOf('backup_logs').length).toBeGreaterThan(0);
    expect(insertsOf('security_audit_log').length).toBeGreaterThan(0);
  });
});

describe('backup upload — admin-only + anti-tamper + tenant', () => {
  test('supervisor cannot restore', async () => {
    mockDb = makeDb(baseDb());
    const res = await backupUploadPOST(authedAs('u-sup', 'supervisor', { backupData: {}, fileHash: 'x' }, 'POST'));
    expect(res.status).toBe(403);
  });

  test('backup for another company is rejected', async () => {
    mockDb = makeDb(baseDb());
    const res = await backupUploadPOST(authedAs('u-admin', 'admin', {
      backupData: { metadata: { company_id: C2 }, data: {} }, fileHash: 'x',
    }, 'POST'));
    expect(res.status).toBe(403);
  });

  test('tampered / unknown backup (no matching HMAC log) is rejected', async () => {
    mockDb = makeDb(baseDb()); // no backup_logs entry
    const backupData = {
      metadata: { company_id: C1, email: 'co@x.com' },
      data: { accounts: [{ id: 'a1', company_id: C1, code: '1130' }] },
    };
    const res = await backupUploadPOST(authedAs('u-admin', 'admin', {
      backupData, fileHash: sign(backupData).substring(0, 16),
    }, 'POST'));
    expect(res.status).toBe(400);
    expect(upsertsOf('accounts')).toHaveLength(0);
  });

  test('a valid, unmodified backup restores through one atomic RPC', async () => {
    const db = baseDb();
    const backupData = {
      metadata: { company_id: C1, email: 'co@x.com' },
      data: { accounts: [{ id: 'a1', company_id: C1, code: '1130', name: 'العملاء' }] },
    };
    db.backup_logs.push({ id: 'bl-1', company_id: C1, hmac_signature: sign(backupData) });
    mockDb = makeDb(db);
    const res = await backupUploadPOST(authedAs('u-admin', 'admin', {
      backupData, fileHash: sign(backupData).substring(0, 16),
    }, 'POST'));
    expect(res.status).toBe(200);
    expect(mockDb.rpcCalls).toEqual([{
      name: 'restore_company_backup_atomic',
      params: {
        p_company_id: C1,
        p_user_id: 'u-admin',
        p_hmac_signature: sign(backupData),
        p_data: backupData.data,
      },
    }]);
    expect(upsertsOf('accounts')).toHaveLength(0);
  });

  test('a backup containing another company row is rejected', async () => {
    const db = baseDb();
    const backupData = {
      metadata: { company_id: C1, email: 'co@x.com' },
      data: { accounts: [
        { id: 'a1', company_id: C1, code: '1130' },
        { id: 'aX', company_id: C2, code: '9999' }, // foreign
      ] },
    };
    db.backup_logs.push({ id: 'bl-1', company_id: C1, hmac_signature: sign(backupData) });
    mockDb = makeDb(db);
    const res = await backupUploadPOST(authedAs('u-admin', 'admin', {
      backupData, fileHash: 'x',
    }, 'POST'));
    expect(res.status).toBe(400);
    expect(upsertsOf('accounts')).toHaveLength(0);
  });
});
