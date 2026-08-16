/**
 * Section 10 tests — Company settings, Users & RBAC
 *
 * Critical fixes covered:
 * 1. settings PUT was requireApiAuth — ANY authenticated user (even supervisor)
 *    could change company financial fields (vat_rate, tax_number). Now company
 *    core fields require admin; the whole route requires manager+; vat_rate is
 *    validated as a fraction [0,1].
 * 2. permissions GET ?userId now tenant-checks the target; the full permission
 *    listing is manager+ only; batch POST validates module/action enums.
 * 3. company/logo POST hardened to manager+.
 * (Existing single-admin / self-change guards in company/users are confirmed.)
 */

process.env.TOKEN_SECRET = 'test-secret-key-for-unit-tests-32chars!';

import { createToken } from '@/lib/auth';

type Row = Record<string, any>;
type Op = { op: string; col?: string; val?: any };

function makeDb(db: Record<string, Row[]>) {
  const calls: Array<{ table: string; ops: Op[]; mut: { kind?: string; payload?: any } }> = [];
  let insertCounter = 0;
  // Lets a test simulate a database rejecting a write, to prove the route
  // reports the failure instead of answering {updated:true}.
  const tableErrors = new Map<string, { message: string; code?: string }>();

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
      neq: (col: string, val: any) => { ops.push({ op: 'neq', col, val }); return api; },
      in: (col: string, val: any) => { ops.push({ op: 'in', col, val }); return api; },
      is: (col: string, val: any) => { ops.push({ op: 'is', col, val }); return api; },
      or: () => api,
      gte: () => api,
      lte: () => api,
      ilike: () => api,
      order: () => api,
      limit: () => api,
      range: () => api,
      insert: (payload: any) => { mut.kind = 'insert'; mut.payload = payload; return api; },
      update: (payload: any) => { mut.kind = 'update'; mut.payload = payload; return api; },
      upsert: (payload: any) => { mut.kind = 'insert'; mut.payload = payload; return api; },
      delete: () => { mut.kind = 'delete'; return api; },
      maybeSingle: async () => ({ data: applyFilters()[0] ?? null, error: null }),
      single: async () => {
        if (mut.kind === 'insert') {
          mut.payload = { id: `id-${++insertCounter}`, ...mut.payload };
          (db[table] = db[table] || []).push(mut.payload);
          return { data: mut.payload, error: null };
        }
        if (mut.kind === 'update') {
          return { data: { ...applyFilters()[0], ...mut.payload }, error: null };
        }
        if (mut.kind === 'delete') {
          return { data: applyFilters()[0] ?? { deleted: true }, error: null };
        }
        const row = applyFilters()[0] ?? null;
        return { data: row, error: row ? null : { message: 'not found' } };
      },
      then: (onF: any, onR: any) => {
        const failure = tableErrors.get(table);
        if (failure) return Promise.resolve({ data: null, count: 0, error: failure }).then(onF, onR);
        return Promise.resolve({ data: applyFilters(), count: applyFilters().length, error: null }).then(onF, onR);
      },
    };
    return api;
  };

  const db_: any = {
    from, calls, rpcCalls: [] as Array<{ name: string; params: any }>,
    failTable: (table: string, error: { message: string; code?: string }) => tableErrors.set(table, error),
  };
  db_.rpcImpl = async (name: string) => ({ data: null, error: { message: `missing ${name}` } });
  db_.rpc = (name: string, params: any) => {
    db_.rpcCalls.push({ name, params });
    return db_.rpcImpl(name, params);
  };
  return db_;
}

let mockDb: ReturnType<typeof makeDb>;

jest.mock('@/lib/supabase-client', () => ({ getSupabase: () => mockDb }));

import { PUT as settingsPUT } from '@/app/api/settings/route';
import { GET as permissionsGET, POST as permissionsPOST } from '@/app/api/permissions/route';
import { DELETE as userDELETE, PUT as userPUT } from '@/app/api/company/users/[id]/route';
import { POST as usersListPOST } from '@/app/api/company/users/route';

const C1 = 'company-1';
const C2 = 'company-2';

function baseDb() {
  return {
    users: [
      { id: 'u-admin', company_id: C1, name: 'مدير', email: 'admin@x.com', role: 'admin', is_active: true, token_version: 0 },
      { id: 'u-mgr', company_id: C1, name: 'مدير عام', email: 'mgr@x.com', role: 'manager', is_active: true, token_version: 0 },
      { id: 'u-sup', company_id: C1, name: 'مشرف', email: 'sup@x.com', role: 'supervisor', is_active: true, token_version: 0 },
      { id: 'u-target', company_id: C1, name: 'هدف', email: 'tgt@x.com', role: 'accountant', is_active: true, token_version: 0 },
      { id: 'u-foreign', company_id: C2, name: 'أجنبي', email: 'f@x.com', role: 'admin', is_active: true, token_version: 0 },
    ],
    companies: [{ id: C1, name: 'شركة', is_active: true }],
    settings: [] as Row[],
    user_permissions: [] as Row[],
    audit_log: [] as Row[],
    subscriptions: [{
      id: 's1', company_id: C1, plan_id: 'p1', plan_code: 'start', status: 'active',
      start_date: '2024-01-01',
      end_date: new Date(Date.now() + 30 * 86400000).toISOString().split('T')[0],
      subscription_plans: { code: 'start', name: 'Start', features_modules: {} },
    }],
  } as Record<string, Row[]>;
}

function authedAs(userId: string, role: string, body?: any, method = 'PUT') {
  const token = createToken(userId, role);
  return {
    url: 'http://localhost/api/test',
    method,
    headers: { get: (k: string) => (k === 'authorization' ? `Bearer ${token}` : null) },
    cookies: { get: () => undefined },
    json: async () => body,
  } as any;
}
const urlOf = (qs = '') => `http://localhost/api/test${qs}`;
const withUrl = (req: any, qs = '') => ({ ...req, url: urlOf(qs) });
const paramsOf = (id: string) => ({ params: Promise.resolve({ id }) });
const updatesOf = (t: string) => mockDb.calls.filter((c) => c.mut.kind === 'update' && c.table === t);
const insertsOf = (t: string) => mockDb.calls.filter((c) => c.mut.kind === 'insert' && c.table === t);

// ---------------------------------------------------------------------------

describe('settings PUT — privilege escalation fix', () => {
  test('supervisor is blocked (needs manager+)', async () => {
    mockDb = makeDb(baseDb());
    const res = await settingsPUT(authedAs('u-sup', 'supervisor', { company: { name: 'هجوم' } }));
    expect(res.status).toBe(403);
    expect(updatesOf('companies')).toHaveLength(0);
  });

  test('manager can save operational settings but NOT company core fields', async () => {
    mockDb = makeDb(baseDb());
    const res = await settingsPUT(authedAs('u-mgr', 'manager', { company: { name: 'تغيير' } }));
    expect(res.status).toBe(403);
    expect((await res.json()).message).toContain('مدير نظام');
    expect(updatesOf('companies')).toHaveLength(0);
  });

  test('manager CAN save settings key-values (operational)', async () => {
    mockDb = makeDb(baseDb());
    const res = await settingsPUT(authedAs('u-mgr', 'manager', { settings: { notif_invoice: 'true' } }));
    expect(res.status).toBe(200);
    expect(updatesOf('companies')).toHaveLength(0);
    expect(insertsOf('settings').length).toBeGreaterThan(0);
  });

  test('admin updates company fields with a valid vat_rate fraction', async () => {
    mockDb = makeDb(baseDb());
    const res = await settingsPUT(authedAs('u-admin', 'admin', { company: { name: 'شركة جديدة', vat_rate: 0.15 } }));
    expect(res.status).toBe(200);
    const upd = updatesOf('companies')[0];
    expect(upd.mut.payload.vat_rate).toBe(0.15);
    expect(upd.mut.payload.name).toBe('شركة جديدة');
  });

  test('the company update is filtered by id only — companies has no company_id column', async () => {
    mockDb = makeDb(baseDb());
    const res = await settingsPUT(authedAs('u-admin', 'admin', { company: { tax_number: '3001' } }));
    expect(res.status).toBe(200);
    const upd = updatesOf('companies')[0];
    // `companies` is keyed by id and has NO company_id column. Adding
    // .eq('company_id', ...) made PostgREST reject the statement (42703), and
    // because the error was ignored the route still answered {updated:true} —
    // so changing the tax number or VAT rate silently did nothing.
    const cols = upd.ops.filter((o: any) => o.op === 'eq').map((o: any) => o.col);
    expect(cols).toContain('id');
    expect(cols).not.toContain('company_id');
  });

  test('a failed company update surfaces as an error instead of a false success', async () => {
    mockDb = makeDb(baseDb());
    mockDb.failTable('companies', { message: 'column companies.company_id does not exist', code: '42703' });
    const res = await settingsPUT(authedAs('u-admin', 'admin', { company: { vat_rate: 0.15 } }));
    expect(res.status).toBeGreaterThanOrEqual(400);
    expect((await res.json()).success).toBe(false);
  });

  test('a failed settings upsert surfaces as an error instead of a false success', async () => {
    mockDb = makeDb(baseDb());
    mockDb.failTable('settings', { message: 'write failed' });
    const res = await settingsPUT(authedAs('u-mgr', 'manager', { settings: { notif_invoice: 'true' } }));
    expect(res.status).toBeGreaterThanOrEqual(400);
    expect((await res.json()).success).toBe(false);
  });

  test('admin rejected for an invalid vat_rate (> 1)', async () => {
    mockDb = makeDb(baseDb());
    const res = await settingsPUT(authedAs('u-admin', 'admin', { company: { vat_rate: 1.5 } }));
    expect(res.status).toBe(400);
    expect(updatesOf('companies')).toHaveLength(0);
  });

  test('admin rejected for an invalid email', async () => {
    mockDb = makeDb(baseDb());
    const res = await settingsPUT(authedAs('u-admin', 'admin', { company: { email: 'not-an-email' } }));
    expect(res.status).toBe(400);
  });
});

describe('permissions — tenant + enum hardening', () => {
  test('GET ?userId for a foreign-company user → 404', async () => {
    mockDb = makeDb(baseDb());
    const res = await permissionsGET(withUrl(authedAs('u-admin', 'admin', undefined, 'GET'), `?userId=u-foreign`));
    expect(res.status).toBe(404);
  });

  test('GET full listing by supervisor → 403', async () => {
    mockDb = makeDb(baseDb());
    const res = await permissionsGET(withUrl(authedAs('u-sup', 'supervisor', undefined, 'GET')));
    expect(res.status).toBe(403);
  });

  test('GET full listing by admin → 200', async () => {
    mockDb = makeDb(baseDb());
    const res = await permissionsGET(withUrl(authedAs('u-admin', 'admin', undefined, 'GET')));
    expect(res.status).toBe(200);
  });

  test('POST by non-admin → 403', async () => {
    mockDb = makeDb(baseDb());
    const res = await permissionsPOST(authedAs('u-sup', 'supervisor', { user_id: 'u-target', batch: true, permissions: [] }, 'POST'));
    expect(res.status).toBe(403);
  });

  test('POST batch rejects an unknown module', async () => {
    mockDb = makeDb(baseDb());
    const res = await permissionsPOST(authedAs('u-admin', 'admin', {
      user_id: 'u-target', batch: true,
      permissions: [{ module: 'evil_module', actions: ['read'] }],
    }, 'POST'));
    expect(res.status).toBe(400);
    expect(insertsOf('user_permissions')).toHaveLength(0);
  });

  test('POST batch rejects an unknown action', async () => {
    mockDb = makeDb(baseDb());
    const res = await permissionsPOST(authedAs('u-admin', 'admin', {
      user_id: 'u-target', batch: true,
      permissions: [{ module: 'invoices', actions: ['read', 'hack'] }],
    }, 'POST'));
    expect(res.status).toBe(400);
  });

  test('POST batch delegates an atomic tenant-scoped replacement to PostgreSQL', async () => {
    mockDb = makeDb(baseDb());
    mockDb.rpcImpl = async () => ({ data: { replaced: 1 }, error: null });
    const permissions = [{ module: 'invoices', actions: ['read', 'create'] }];
    const res = await permissionsPOST(authedAs('u-admin', 'admin', {
      user_id: 'u-target', batch: true, permissions,
    }, 'POST'));
    expect(res.status).toBe(200);
    expect(mockDb.rpcCalls).toEqual([{
      name: 'replace_user_permissions',
      params: { p_company_id: C1, p_user_id: 'u-target', p_permissions: permissions, p_bypass_telegram: false },
    }]);
    expect(insertsOf('user_permissions')).toHaveLength(0);
  });

  test('POST target user from another company → 404', async () => {
    mockDb = makeDb(baseDb());
    const res = await permissionsPOST(authedAs('u-admin', 'admin', {
      user_id: 'u-foreign', module: 'invoices', actions: ['read'],
    }, 'POST'));
    expect(res.status).toBe(404);
  });
});

describe('company/users — guards (regression)', () => {
  test('cannot create a second admin (single-admin constraint)', async () => {
    mockDb = makeDb(baseDb()); // u-admin already exists
    const res = await usersListPOST(authedAs('u-admin', 'admin', {
      email: 'new@x.com', name: 'ثاني', password: '123456', role: 'admin',
    }, 'POST'));
    expect(res.status).toBe(403);
    expect((await res.json()).message).toContain('مدير');
  });

  test('invalid role rejected before any write', async () => {
    mockDb = makeDb(baseDb());
    const res = await usersListPOST(authedAs('u-admin', 'admin', {
      email: 'new@x.com', name: 'x', password: '123456', role: 'superuser',
    }, 'POST'));
    expect(res.status).toBe(400);
  });

  test('cannot delete your own account', async () => {
    mockDb = makeDb(baseDb());
    const res = await userDELETE(authedAs('u-admin', 'admin', undefined, 'DELETE'), paramsOf('u-admin'));
    expect(res.status).toBe(400);
  });

  test('cannot change your own role away from admin', async () => {
    mockDb = makeDb(baseDb());
    const res = await userPUT(authedAs('u-admin', 'admin', { role: 'manager' }, 'PUT'), paramsOf('u-admin'));
    expect(res.status).toBe(400);
  });
});
