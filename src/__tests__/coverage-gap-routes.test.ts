/**
 * Route-boundary tests closing coverage gaps on smaller admin/settings/
 * subscription/equipment routes.
 */
process.env.TOKEN_SECRET = 'test-secret-key-for-unit-tests-32chars!';
process.env.ADMIN_TOKEN_SECRET = 'test-admin-secret-key-for-unit-tests-32chars!';
import { createAdminToken, createToken, hashPassword } from '@/lib/auth';

type Row = Record<string, unknown>;
type Op = { op: string; col?: string; val?: unknown };

function makeDb(db: Record<string, Row[]>) {
  const calls: Array<{ table: string; ops: Op[] }> = [];
  const rpcResults = new Map<string, { data: unknown; error?: unknown }>();
  const from = (table: string) => {
    const ops: Op[] = [];
    calls.push({ table, ops });
    const rows = () =>
      (db[table] || []).filter((r) =>
        ops.every((o) => {
          const get = (col: string): unknown => {
            let cur: unknown = r;
            for (const k of col.split('.')) {
              if (cur == null) break;
              cur = (cur as Record<string, unknown>)[k];
            }
            return cur;
          };
          if (o.op === 'eq') return get(o.col!) === o.val;
          if (o.op === 'in') return (o.val as unknown[]).includes(get(o.col!));
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
    from, calls, rpcResults, db,
    rpc: async (name: string) => rpcResults.get(name) || { data: null, error: null },
  };
}

let mockDb: ReturnType<typeof makeDb>;
jest.mock('@/lib/supabase-client', () => ({ getSupabase: () => mockDb }));

import { POST as maintPOST } from '@/app/api/equipment/[id]/maintenance/route';
import type { TestBuilder } from './mocks';
import type { NextRequest } from 'next/server';
import { GET as addonGET, POST as addonPOST } from '@/app/api/subscription/addon-request/route';
import { GET as faGET } from '@/app/api/financial-audit/route';
import { GET as payMethodsGET } from '@/app/api/payment-methods/route';
import { POST as subscribePOST } from '@/app/api/auth/subscribe/route';
import { GET as adminSessionGET } from '@/app/api/admin/session/route';
import { GET as appSettingsGET } from '@/app/api/app-settings/route';
import { POST as togglePOST } from '@/app/api/admin/users/toggle-status/route';
import { PATCH as userPATCH } from '@/app/api/admin/users/[id]/route';
import { GET as companiesGET } from '@/app/api/admin/companies/route';
import { GET as subStatusGET } from '@/app/api/auth/subscription-status/route';
import { GET as subGET } from '@/app/api/auth/subscription/route';
import { POST as seedChartPOST } from '@/app/api/settings/seed-chart/route';
import { POST as seedDefaultPOST } from '@/app/api/accounts/seed-default/route';
import { GET as logsGET, DELETE as logsDELETE } from '@/app/api/admin/logs/route';
import { resetRateLimits } from '@/lib/memory-rate-limit';

const C1 = 'company-1';
const U1 = '00000000-0000-4000-8000-0000000000u1';
const A1 = '00000000-0000-4000-8000-0000000000a1';
const EQID = '00000000-0000-4000-8000-0000000000e1';
const EQUID = '00000000-0000-4000-8000-0000000000f1';

function userReq(method = 'GET', url = 'http://localhost/x', body?: Row) {
  const token = createToken(U1, 'admin', 0);
  return {
    url, method, nextUrl: new URL(url),
    headers: { get: (k: string) => (k === 'authorization' ? `Bearer ${token}` : null) },
    cookies: { get: () => undefined },
    json: async () => body,
  } as unknown as NextRequest;
}

let masterHash = '';
function adminReq(method = 'GET', url = 'http://localhost/x', body?: Row, master?: string) {
  const token = createAdminToken(A1, 0);
  return {
    url, method, nextUrl: new URL(url),
    headers: { get: (k: string) => (k === 'x-master-password' ? (master ?? null) : null) },
    cookies: { get: (name: string) => (name === 'admin_token' ? { value: token } : undefined) },
    json: async () => body, text: async () => JSON.stringify(body),
  } as unknown as NextRequest;
}

const MODULES = {
  equipment: true, reports: true, settings: true, accounts: true,
  subscriptions: true, users: true,
};

function baseDb() {
  return {
    users: [{ id: U1, company_id: C1, name: 'م', email: 'admin@example.com', is_active: true, token_version: 0, role: 'admin' }],
    companies: [{ id: C1, is_active: true, name: 'شركة' }],
    subscriptions: [{
      id: 's1', company_id: C1, status: 'active', end_date: '2099-01-01', plan_code: 'enterprise',
      subscription_plans: { code: 'enterprise', features_modules: MODULES, max_users: 10, max_projects: 5 },
    }],
    admin_users: [{ id: A1, email: 'admin@example.com', name: 'مدير', is_active: true, token_version: 0, master_password_hash: masterHash }],
    subscription_plans: [], payment_methods: [], addon_requests: [], financial_audit_trails: [],
    equipment: [], app_settings: [], accounts: [], admin_audit_log: [],
  } as Record<string, Row[]>;
}

beforeAll(async () => {
  masterHash = await hashPassword('master-pass');
});

beforeEach(() => {
  resetRateLimits();
  mockDb = makeDb(baseDb());
});

describe('equipment/[id]/maintenance', () => {
  test('rejects an invalid equipment id', async () => {
    const res = await maintPOST(userReq('POST', 'http://localhost/x', {}), { params: Promise.resolve({ id: 'bad' }) });
    expect(res.status).toBe(400);
  });

  test('rejects an invalid maintenance body', async () => {
    const res = await maintPOST(userReq('POST', 'http://localhost/x', { maintenance_date: 'nope' }), { params: Promise.resolve({ id: EQID }) });
    expect(res.status).toBe(400);
  });

  test('returns 404 when the equipment does not exist', async () => {
    const res = await maintPOST(
      userReq('POST', 'http://localhost/x', { maintenance_date: '2026-05-01', description: 'صيانة' }),
      { params: Promise.resolve({ id: EQID }) }
    );
    expect(res.status).toBe(404);
  });

  test('records maintenance successfully and returns 201', async () => {
    mockDb.db.equipment.push({ id: EQID, company_id: C1 });
    mockDb.rpcResults.set('record_equipment_maintenance_atomic', { data: { id: 'm1' } });
    const res = await maintPOST(
      userReq('POST', 'http://localhost/x', {
        maintenance_date: '2026-05-01', type: 'repair', description: 'إصلاح',
        cost: 150, performed_by: 'أحمد', next_maintenance_date: '2026-06-01', parts_replaced: 'فلتر',
      }),
      { params: Promise.resolve({ id: EQID }) }
    );
    expect(res.status).toBe(201);
    const body = await res.json();
    expect(body.success).toBe(true);
  });
});

describe('subscription/addon-request', () => {
  test('GET returns the current user requests', async () => {
    mockDb.db.addon_requests.push({ id: 'r1', addon_type: 'extra_user', quantity: 1, company_id: C1, user_id: U1 });
    const res = await addonGET(userReq('GET', 'http://localhost/addon-request'));
    const body = await res.json();
    expect(body.success).toBe(true);
    expect(body.data.requests.length).toBe(1);
  });

  test('POST rejects an invalid addon type', async () => {
    const res = await addonPOST(userReq('POST', 'http://localhost/x', { addon_type: 'nope', quantity: 1, duration_type: 'monthly', payment_method_code: 'card' }));
    expect(res.status).toBe(400);
  });

  test('POST rejects an invalid quantity', async () => {
    const res = await addonPOST(userReq('POST', 'http://localhost/x', { addon_type: 'extra_user', quantity: 0, duration_type: 'monthly', payment_method_code: 'card' }));
    expect(res.status).toBe(400);
  });

  test('POST rejects an invalid duration', async () => {
    const res = await addonPOST(userReq('POST', 'http://localhost/x', { addon_type: 'extra_user', quantity: 1, duration_type: 'weekly', payment_method_code: 'card' }));
    expect(res.status).toBe(400);
  });

  test('POST rejects a missing receipt reference', async () => {
    const res = await addonPOST(userReq('POST', 'http://localhost/x', {
      addon_type: 'extra_user', quantity: 1, duration_type: 'monthly',
      payment_method_code: 'card', receipt_image_url: 'https://evil.com/x.png',
    }));
    expect(res.status).toBe(400);
  });

  test('POST rejects an invalid payment date', async () => {
    const res = await addonPOST(userReq('POST', 'http://localhost/x', {
      addon_type: 'extra_user', quantity: 1, duration_type: 'monthly',
      payment_method_code: 'card', receipt_image_url: `${C1}/receipt.png`, payment_date: 'bad-date',
    }));
    expect(res.status).toBe(400);
  });

  test('POST creates a request and returns 201', async () => {
    mockDb.rpcResults.set('create_addon_request_atomic', { data: { id: 'r2', total_amount_usd: 10 } });
    const res = await addonPOST(userReq('POST', 'http://localhost/x', {
      addon_type: 'extra_user', quantity: 2, duration_type: 'yearly',
      payment_method_code: 'bank-transfer', payment_date: '2026-05-01', payment_time: '14:30',
      receipt_image_url: `${C1}/receipt.png`, notes: 'سريع',
    }));
    expect(res.status).toBe(201);
  });

  test('POST maps a duplicate-pending error to 409', async () => {
    mockDb.rpcResults.set('create_addon_request_atomic', { data: null, error: { code: '23505', message: 'dup' } });
    const res = await addonPOST(userReq('POST', 'http://localhost/x', {
      addon_type: 'extra_user', quantity: 1, duration_type: 'monthly',
      payment_method_code: 'card', payment_date: '2026-05-01',
      receipt_image_url: `${C1}/receipt.png`,
    }));
    expect(res.status).toBe(409);
  });
});

describe('financial-audit', () => {
  test('GET returns filtered audit rows', async () => {
    mockDb.db.financial_audit_trails.push({ id: 'f1', company_id: C1, entity_type: 'invoice', entity_id: 'e1', action: 'update' });
    const res = await faGET(userReq('GET', 'http://localhost/financial-audit?entity_type=invoice&entity_id=e1&action=update&page=1&pageSize=10'));
    const body = await res.json();
    expect(body.success).toBe(true);
    expect(body.data.rows.length).toBe(1);
  });
});

describe('payment-methods', () => {
  test('GET returns active payment methods', async () => {
    mockDb.db.payment_methods.push({ id: 'pm1', code: 'card', is_active: true, sort_order: 1 });
    const res = await payMethodsGET(userReq('GET', 'http://localhost/payment-methods'));
    const body = await res.json();
    expect(body.success).toBe(true);
    expect(body.data.methods.length).toBe(1);
  });

});

describe('auth/subscribe', () => {
  test('POST is disabled with a 410 and requires admin', async () => {
    const res = await subscribePOST(userReq('POST', 'http://localhost/x'));
    expect(res.status).toBe(410);
  });
});

describe('admin/session', () => {
  test('GET returns the admin context', async () => {
    const res = await adminSessionGET(adminReq('GET', 'http://localhost/session'));
    const body = await res.json();
    expect(body.success).toBe(true);
    expect(body.data.email).toBe('admin@example.com');
    expect(body.data.role).toBe('superadmin');
  });

  test('GET returns an unauthorized error without a token', async () => {
    const req = { url: 'http://localhost/x', cookies: { get: () => undefined } } as unknown as NextRequest;
    const res = await adminSessionGET(req);
    expect(res.status).toBe(401);
  });
});

describe('app-settings', () => {
  test('GET returns allow-listed settings', async () => {
    mockDb.db.app_settings.push({ key: 'app_name', value: 'برو' });
    const res = await appSettingsGET(userReq('GET', 'http://localhost/app-settings'));
    const body = await res.json();
    expect(body.success).toBe(true);
    expect(body.data.app_name).toBe('برو');
  });
});

describe('admin/users/toggle-status', () => {
  test('rejects when master password header is missing', async () => {
    const res = await togglePOST(adminReq('POST', 'http://localhost/x', {}, undefined));
    expect(res.status).toBe(401);
  });

  test('rejects a wrong master password', async () => {
    const res = await togglePOST(adminReq('POST', 'http://localhost/x', { userId: EQUID, is_active: true }, 'wrong'));
    expect(res.status).toBe(401);
  });

  test('rejects invalid userId / is_active payload', async () => {
    const res = await togglePOST(adminReq('POST', 'http://localhost/x', { userId: 'bad', is_active: 'yes' }, 'master-pass'));
    expect(res.status).toBe(400);
  });

  test('toggles user status successfully', async () => {
    const res = await togglePOST(adminReq('POST', 'http://localhost/x', { userId: EQUID, is_active: true }, 'master-pass'));
    const body = await res.json();
    expect(body.success).toBe(true);
    expect(body.data.message).toContain('تفعيل');
  });

  test('maps not-found RPC error to 404', async () => {
    mockDb.rpcResults.set('set_company_user_status_atomic', { data: null, error: { message: 'المستخدم غير موجود' } });
    const res = await togglePOST(adminReq('POST', 'http://localhost/x', { userId: EQUID, is_active: true }, 'master-pass'));
    expect(res.status).toBe(404);
  });
});

describe('admin/users/[id] PATCH', () => {
  test('rejects an invalid user id', async () => {
    const res = await userPATCH(adminReq('PATCH', 'http://localhost/x', { is_active: true }, 'master-pass'), { params: Promise.resolve({ id: 'bad' }) });
    expect(res.status).toBe(400);
  });

  test('deactivates a user successfully', async () => {
    const res = await userPATCH(adminReq('PATCH', 'http://localhost/x', { is_active: false }, 'master-pass'), { params: Promise.resolve({ id: EQUID }) });
    const body = await res.json();
    expect(body.success).toBe(true);
  });
});

describe('admin/companies', () => {
  test('GET returns companies with counts and subscription info', async () => {
    mockDb.db.companies.push({ id: 'c2', name: 'شركة ب', is_active: true });
    mockDb.db.users.push({ id: 'u2', company_id: 'c2' });
    mockDb.db.subscriptions.push({
      id: 's2', company_id: 'c2', status: 'active', plan_code: 'basic', subscriber_number: 'SN1',
      subscription_plans: { name: 'الأساسية', max_users: 3, max_projects: 2 },
    });
    const res = await companiesGET(adminReq('GET', 'http://localhost/companies?page=1&pageSize=10'));
    const body = await res.json();
    expect(body.success).toBe(true);
    expect(body.data.companies.length).toBe(2);
  });
});

describe('auth/subscription-status', () => {
  test('GET returns subscription access', async () => {
    const res = await subStatusGET(userReq('GET', 'http://localhost/subscription-status'));
    const body = await res.json();
    expect(body.success).toBe(true);
    expect(body.data.status).toBe('active');
  });
});

describe('auth/subscription', () => {
  test('GET returns plans and the current subscription', async () => {
    mockDb.db.subscription_plans.push({ id: 'p1', code: 'enterprise', name: 'مؤسسات', is_active: true, features_modules: MODULES });
    const res = await subGET(userReq('GET', 'http://localhost/subscription'));
    const body = await res.json();
    expect(body.success).toBe(true);
    expect(body.data.subscription.plan_code).toBe('enterprise');
  });
});

describe('settings/seed-chart and accounts/seed-default', () => {
  test('settings/seed-chart creates the default chart of accounts', async () => {
    const res = await seedChartPOST(userReq('POST', 'http://localhost/x'));
    expect(res.status).toBe(200);
  });

  test('accounts/seed-default seeds accounts and audits', async () => {
    const res = await seedDefaultPOST(userReq('POST', 'http://localhost/x'));
    const body = await res.json();
    expect(body.success).toBe(true);
  });
});

describe('admin/logs', () => {
  test('GET returns logs with pagination and search', async () => {
    mockDb.db.admin_audit_log.push({ id: 'l1', action: 'login', details: 'دخول', created_at: '2026-01-01T00:00:00Z', ip_address: '1.2.3.4' });
    const res = await logsGET(adminReq('GET', 'http://localhost/logs?page=1&pageSize=50&search=login&action=login&from=2026-01-01&to=2026-01-31'));
    const body = await res.json();
    expect(body.success).toBe(true);
  });

  test('GET rejects an invalid date range', async () => {
    const res = await logsGET(adminReq('GET', 'http://localhost/logs?from=not-a-date'));
    expect(res.status).toBe(400);
  });

  test('GET rejects a from-date after the to-date', async () => {
    const res = await logsGET(adminReq('GET', 'http://localhost/logs?from=2026-02-01&to=2026-01-01'));
    expect(res.status).toBe(400);
  });

  test('DELETE blocks clearing the append-only audit log', async () => {
    const res = await logsDELETE(adminReq('DELETE', 'http://localhost/x', { masterPassword: 'master-pass' }));
    expect(res.status).toBe(403);
  });
});
