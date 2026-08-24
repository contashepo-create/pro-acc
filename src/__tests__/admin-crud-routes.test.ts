/**
 * Route-boundary tests for the superadmin panel CRUD routes:
 * /api/admin/{companies,users,subscriptions,reports,activation-codes,
 * database,database/backup,database/restore,advertisements,
 * advertisements/tracking,logs,stats,dashboard,session}.
 * All use the cookie-based admin_token JWT + admin_users row.
 */
process.env.TOKEN_SECRET = 'test-secret-key-for-unit-tests-32chars!';
process.env.ADMIN_TOKEN_SECRET = 'test-admin-secret-key-for-unit-tests-32chars!';
import { createAdminToken, hashPassword } from '@/lib/auth';

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
          if (o.op === 'gte') return String(get(o.col!)) >= String(o.val);
          if (o.op === 'lte') return String(get(o.col!)) <= String(o.val);
          if (o.op === 'lt') return String(get(o.col!)) < String(o.val);
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
  };
}

let mockDb: ReturnType<typeof makeDb>;
jest.mock('@/lib/supabase-client', () => ({ getSupabase: () => mockDb }));

import { GET as sessionGET } from '@/app/api/admin/session/route';
import { GET as statsGET } from '@/app/api/admin/stats/route';
import type { TestBuilder } from './mocks';
import type { NextRequest } from 'next/server';
import { GET as dashboardGET } from '@/app/api/admin/dashboard/route';
import { GET as companiesGET } from '@/app/api/admin/companies/route';
import { GET as usersGET } from '@/app/api/admin/users/route';
import { GET as userActivityGET } from '@/app/api/admin/users/[id]/activity/route';
import { GET as subscriptionsGET } from '@/app/api/admin/subscriptions/route';
import { GET as subGET, PUT as subPUT } from '@/app/api/admin/subscriptions/[id]/route';
import { GET as reportsGET } from '@/app/api/admin/reports/route';
import { GET as codesGET, POST as codesPOST } from '@/app/api/admin/activation-codes/route';
import { GET as databaseGET } from '@/app/api/admin/database/route';
import { POST as dbBackupPOST } from '@/app/api/admin/database/backup/route';
import { POST as dbRestorePOST } from '@/app/api/admin/database/restore/route';
import { GET as adsGET, POST as adsPOST, PATCH as adsPATCH, DELETE as adsDELETE } from '@/app/api/admin/advertisements/route';
import { GET as adsTrackGET } from '@/app/api/admin/advertisements/tracking/route';
import { GET as logsGET, DELETE as logsDELETE } from '@/app/api/admin/logs/route';
import { GET as companyGET, PATCH as companyPATCH } from '@/app/api/admin/companies/[id]/route';
import { POST as companyTogglePOST } from '@/app/api/admin/companies/toggle-status/route';
import { POST as extendTrialPOST } from '@/app/api/admin/companies/[id]/extend-trial/route';
import { POST as userTogglePOST } from '@/app/api/admin/users/toggle-status/route';
import { PATCH as userPATCH } from '@/app/api/admin/users/[id]/route';

const A1 = '00000000-0000-4000-8000-0000000000a1';
const C1 = '00000000-0000-4000-8000-0000000000c1';
const SUB = '00000000-0000-4000-8000-0000000000b1';
const UID = '00000000-0000-4000-8000-0000000000d1';

let masterHash = '';

function adminReq(method = 'GET', url = 'http://localhost/x', body?: Row, master?: string) {
  const token = createAdminToken(A1, 0);
  return { url, method, nextUrl: new URL(url), headers: { get: (k: string) => k === 'x-master-password' ? (master ?? null) : null },
    cookies: { get: (name: string) => name === 'admin_token' ? { value: token } : undefined },
    json: async () => body, text: async () => JSON.stringify(body) } as unknown as NextRequest;
}

function baseDb() {
  return {
    admin_users: [{ id: A1, email: 'admin@example.com', name: 'مدير', is_active: true, token_version: 0, master_password_hash: masterHash }],
    companies: [{ id: C1, name: 'شركة', is_active: true }],
    users: [{ id: UID, company_id: C1, name: 'مستخدم', email: 'u@example.com', role: 'admin', is_active: true }],
    subscriptions: [{ id: SUB, company_id: C1, plan_code: 'enterprise', status: 'active' }],
    admin_audit_log: [], login_attempts: [], activation_codes: [], advertisements: [],
    ad_views: [], ad_clicks: [], ad_notifications: [], projects: [],
  } as Record<string, Row[]>;
}

beforeAll(async () => {
  masterHash = await hashPassword('master-pass');
});
beforeEach(() => { mockDb = makeDb(baseDb()); });

describe('admin/session GET', () => {
  test('returns the admin identity', async () => {
    const res = await sessionGET(adminReq('GET', 'http://localhost/api/admin/session'));
    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.data.role).toBe('superadmin');
  });
});

describe('admin/stats GET', () => {
  test('returns platform counters', async () => {
    const res = await statsGET(adminReq('GET', 'http://localhost/api/admin/stats'));
    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.data.companies).toBe(1);
  });
});

describe('admin/dashboard GET', () => {
  test('returns dashboard aggregates', async () => {
    const res = await dashboardGET(adminReq('GET', 'http://localhost/api/admin/dashboard'));
    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.data.companiesCount).toBe(1);
  });
});

describe('admin/companies GET', () => {
  test('lists companies with user/subscription summaries', async () => {
    const res = await companiesGET(adminReq('GET', 'http://localhost/api/admin/companies'));
    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.data.companies).toHaveLength(1);
    expect(json.data.companies[0].user_count).toBe(1);
    expect(json.data.companies[0].subscription.plan_code).toBe('enterprise');
  });
});

describe('admin/users GET', () => {
  test('lists all users', async () => {
    const res = await usersGET(adminReq('GET', 'http://localhost/api/admin/users'));
    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.data).toHaveLength(1);
  });

  test('filters by company_id', async () => {
    const res = await usersGET(adminReq('GET', `http://localhost/api/admin/users?company_id=${C1}`));
    expect(res.status).toBe(200);
  });

  test('returns a single user detail when user_id is given', async () => {
    mockDb = makeDb({ ...baseDb(), users: [{ id: UID, company_id: C1, name: 'مستخدم', email: 'u@example.com', role: 'admin', is_active: true }] });
    const res = await usersGET(adminReq('GET', `http://localhost/api/admin/users?user_id=${UID}`));
    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.data.user.email).toBe('u@example.com');
  });

  test('rejects an invalid user_id filter', async () => {
    const res = await usersGET(adminReq('GET', 'http://localhost/api/admin/users?user_id=bad'));
    expect(res.status).toBe(400);
  });
});

describe('admin/users/[id]/activity GET', () => {
  test('lists activity for a user', async () => {
    mockDb = makeDb({ ...baseDb(), admin_audit_log: [{ id: 'l1', action: 'login', details: 'd', created_at: '2026-01-01', target_type: 'user', target_id: UID }] });
    const res = await userActivityGET(adminReq('GET', `http://localhost/api/admin/users/${UID}/activity`), { params: Promise.resolve({ id: UID }) });
    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.data).toHaveLength(1);
  });

  test('rejects an invalid id', async () => {
    const res = await userActivityGET(adminReq('GET', 'http://localhost/x'), { params: Promise.resolve({ id: 'bad' }) });
    expect(res.status).toBe(400);
  });
});

describe('admin/subscriptions GET', () => {
  test('lists subscriptions', async () => {
    const res = await subscriptionsGET(adminReq('GET', 'http://localhost/api/admin/subscriptions'));
    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.data.subscriptions).toHaveLength(1);
  });

  test('rejects an invalid status filter', async () => {
    const res = await subscriptionsGET(adminReq('GET', 'http://localhost/api/admin/subscriptions?status=bogus'));
    expect(res.status).toBe(400);
  });
});

describe('admin/subscriptions/[id]', () => {
  test('GET returns a subscription', async () => {
    const res = await subGET(adminReq('GET', `http://localhost/x/${SUB}`), { params: Promise.resolve({ id: SUB }) });
    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.data.subscription.plan_code).toBe('enterprise');
  });

  test('GET returns 404 for unknown subscription', async () => {
    mockDb = makeDb({ ...baseDb(), subscriptions: [] });
    const res = await subGET(adminReq('GET', `http://localhost/x/${SUB}`), { params: Promise.resolve({ id: SUB }) });
    expect(res.status).toBe(404);
  });

  test('PUT rejects a paid plan change (409)', async () => {
    const res = await subPUT(adminReq('PUT', 'http://localhost/x', { plan_id: 'p1' }), { params: Promise.resolve({ id: SUB }) });
    expect(res.status).toBe(409);
  });

  test('PUT restricts entitlements via RPC', async () => {
    mockDb.rpcResults.set('restrict_subscription_atomic', { data: { id: SUB }, error: null });
    const res = await subPUT(adminReq('PUT', 'http://localhost/x', { extra_users: 2, status: 'cancelled' }), { params: Promise.resolve({ id: SUB }) });
    expect(res.status).toBe(200);
  });
});

describe('admin/reports GET', () => {
  test('returns ads report with enrichment', async () => {
    mockDb = makeDb({ ...baseDb(), advertisements: [{ id: SUB, title: 'ad', type: 'banner', display_mode: 'top_bar', views: 10, clicks: 2, notifications_sent: 0 }] });
    const res = await reportsGET(adminReq('GET', 'http://localhost/api/admin/reports?type=ads'));
    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.data).toHaveLength(1);
    expect(json.data[0].ctr).toBe(20);
  });

  test('returns approvals report', async () => {
    const res = await reportsGET(adminReq('GET', 'http://localhost/api/admin/reports?type=approvals'));
    expect(res.status).toBe(200);
  });

  test('rejects an invalid report type', async () => {
    const res = await reportsGET(adminReq('GET', 'http://localhost/api/admin/reports?type=bogus'));
    expect(res.status).toBe(400);
  });

  test('rejects an invalid date range', async () => {
    const res = await reportsGET(adminReq('GET', 'http://localhost/api/admin/reports?start=not-a-date'));
    expect(res.status).toBe(400);
  });
});

describe('admin/activation-codes', () => {
  test('GET lists masked codes', async () => {
    mockDb = makeDb({ ...baseDb(), activation_codes: [{ id: SUB, code: 'AB12CD34-EF56-7890-ABCD-EF1234567890', plan_code: 'pro', duration_months: 12, is_used: false }] });
    const res = await codesGET(adminReq('GET', 'http://localhost/api/admin/activation-codes'));
    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.data.codes[0].code).not.toContain('AB12CD34-');
  });

  test('POST generates a batch of codes', async () => {
    const res = await codesPOST(adminReq('POST', 'http://localhost/api/admin/activation-codes', { planCode: 'pro', durationMonths: 12, count: 2 }));
    expect(res.status).toBe(201);
    const json = await res.json();
    expect(json.data.codes).toHaveLength(2);
  });

  test('POST rejects a missing plan for a non-addon code', async () => {
    const res = await codesPOST(adminReq('POST', 'http://localhost/api/admin/activation-codes', {}));
    expect(res.status).toBe(400);
  });
});

describe('admin/database', () => {
  test('GET returns table info', async () => {
    const res = await databaseGET(adminReq('GET', 'http://localhost/api/admin/database'));
    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.data.tables).toHaveLength(11);
  });
});

describe('admin/database/backup + restore', () => {
  test('backup requires a valid master password', async () => {
    const res1 = await dbBackupPOST(adminReq('POST', 'http://localhost/x', {}));
    expect(res1.status).toBe(401);
    const res2 = await dbBackupPOST(adminReq('POST', 'http://localhost/x', { masterPassword: 'master-pass' }));
    expect(res2.status).toBe(200);
  });

  test('restore is blocked with an error after valid master password', async () => {
    const res1 = await dbRestorePOST(adminReq('POST', 'http://localhost/x', {}));
    expect(res1.status).toBe(401);
    const res2 = await dbRestorePOST(adminReq('POST', 'http://localhost/x', { masterPassword: 'master-pass' }));
    expect(res2.status).toBe(403);
  });
});

describe('admin/advertisements', () => {
  test('GET lists ads with active filter', async () => {
    mockDb = makeDb({ ...baseDb(), advertisements: [{ id: SUB, title: 'ad', body: 'b', type: 'banner', display_mode: 'top_bar', priority: 1, is_active: true }] });
    const res = await adsGET(adminReq('GET', 'http://localhost/api/admin/advertisements?active=true'));
    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.data).toHaveLength(1);
  });

  test('GET rejects an invalid display mode', async () => {
    const res = await adsGET(adminReq('GET', 'http://localhost/api/admin/advertisements?display_mode=bogus'));
    expect(res.status).toBe(400);
  });

  test('POST creates an advertisement', async () => {
    mockDb.rpcResults.set('admin_manage_advertisement', { data: { id: SUB }, error: null });
    const res = await adsPOST(adminReq('POST', 'http://localhost/x', { title: 't', body: 'b', type: 'banner', display_mode: 'top_bar' }));
    expect(res.status).toBe(201);
  });

  test('POST rejects an invalid title', async () => {
    const res = await adsPOST(adminReq('POST', 'http://localhost/x', { title: '', body: 'b' }));
    expect(res.status).toBe(400);
  });

  test('PATCH updates an advertisement', async () => {
    mockDb.rpcResults.set('admin_manage_advertisement', { data: { id: SUB }, error: null });
    const res = await adsPATCH(adminReq('PATCH', 'http://localhost/x', { id: SUB, title: 'new' }));
    expect(res.status).toBe(200);
  });

  test('DELETE removes an advertisement', async () => {
    mockDb.rpcResults.set('admin_manage_advertisement', { data: { deleted: true }, error: null });
    const res = await adsDELETE(adminReq('DELETE', 'http://localhost/x', { id: SUB }));
    expect(res.status).toBe(200);
  });

  test('PATCH returns 404 when not found', async () => {
    mockDb.rpcResults.set('admin_manage_advertisement', { data: { not_found: true }, error: null });
    const res = await adsPATCH(adminReq('PATCH', 'http://localhost/x', { id: SUB, title: 'new' }));
    expect(res.status).toBe(404);
  });
});

describe('admin/advertisements/tracking GET', () => {
  test('returns ad statistics', async () => {
    mockDb = makeDb({ ...baseDb(), advertisements: [{ id: SUB, title: 'ad', views: 5, clicks: 1, notifications_sent: 0 }] });
    const res = await adsTrackGET(adminReq('GET', `http://localhost/api/admin/advertisements/tracking?ad_id=${SUB}`));
    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.data.statistics.totalViews).toBe(5);
  });

  test('rejects an invalid ad_id', async () => {
    const res = await adsTrackGET(adminReq('GET', 'http://localhost/api/admin/advertisements/tracking?ad_id=bad'));
    expect(res.status).toBe(400);
  });
});

describe('admin/logs', () => {
  test('GET lists logs with pagination', async () => {
    mockDb = makeDb({ ...baseDb(), admin_audit_log: [{ id: 'l1', action: 'login', details: 'd', ip_address: '1.1.1.1', created_at: '2026-01-01' }] });
    const res = await logsGET(adminReq('GET', 'http://localhost/api/admin/logs'));
    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.data.logs).toHaveLength(1);
  });

  test('GET rejects an invalid date range', async () => {
    const res = await logsGET(adminReq('GET', 'http://localhost/api/admin/logs?from=bad'));
    expect(res.status).toBe(400);
  });

  test('DELETE blocks clearing audit logs even with master password', async () => {
    const res = await logsDELETE(adminReq('DELETE', 'http://localhost/x', { masterPassword: 'master-pass' }));
    expect(res.status).toBe(403);
  });
});

describe('admin/companies/[id]', () => {
  test('GET returns company detail', async () => {
    const res = await companyGET(adminReq('GET', `http://localhost/x/${C1}`), { params: Promise.resolve({ id: C1 }) });
    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.data.company.name).toBe('شركة');
  });

  test('GET returns 404 for unknown company', async () => {
    mockDb = makeDb({ ...baseDb(), companies: [] });
    const res = await companyGET(adminReq('GET', `http://localhost/x/${C1}`), { params: Promise.resolve({ id: C1 }) });
    expect(res.status).toBe(404);
  });

  test('PATCH toggles company status', async () => {
    mockDb.rpcResults.set('set_company_status_atomic', { data: null, error: null });
    const res = await companyPATCH(adminReq('PATCH', 'http://localhost/x', { action: 'toggle_status', is_active: false }, 'master-pass'), { params: Promise.resolve({ id: C1 }) });
    expect(res.status).toBe(200);
  });

  test('PATCH requires master password for edit_company', async () => {
    const res = await companyPATCH(adminReq('PATCH', 'http://localhost/x', { action: 'edit_company' }), { params: Promise.resolve({ id: C1 }) });
    expect(res.status).toBe(401);
  });
});

describe('admin/companies/toggle-status POST', () => {
  test('toggles a company status', async () => {
    const res = await companyTogglePOST(adminReq('POST', 'http://localhost/x', { companyId: C1, is_active: false }, 'master-pass'));
    expect(res.status).toBe(200);
  });

  test('rejects an invalid company id', async () => {
    const res = await companyTogglePOST(adminReq('POST', 'http://localhost/x', { companyId: 'bad', is_active: false }, 'master-pass'));
    expect(res.status).toBe(400);
  });
});

describe('admin/companies/[id]/extend-trial POST', () => {
  test('extends trial by 7 days', async () => {
    mockDb.rpcResults.set('extend_company_trial_atomic', { data: { already_extended: false, end_date: '2026-09-01' }, error: null });
    const res = await extendTrialPOST(adminReq('POST', 'http://localhost/x', { days: 7, masterPassword: 'master-pass' }), { params: Promise.resolve({ id: C1 }) });
    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.data.message).toContain('تم تمديد');
  });

  test('rejects a non-7-day extension', async () => {
    const res = await extendTrialPOST(adminReq('POST', 'http://localhost/x', { days: 14, masterPassword: 'master-pass' }), { params: Promise.resolve({ id: C1 }) });
    expect(res.status).toBe(400);
  });
});

describe('admin/users/toggle-status POST', () => {
  test('toggles a user status', async () => {
    const res = await userTogglePOST(adminReq('POST', 'http://localhost/x', { userId: UID, is_active: false }, 'master-pass'));
    expect(res.status).toBe(200);
  });

  test('rejects missing master password', async () => {
    const res = await userTogglePOST(adminReq('POST', 'http://localhost/x', { userId: UID, is_active: false }));
    expect(res.status).toBe(401);
  });
});

describe('admin/users/[id] PATCH', () => {
  test('updates a user status with master password', async () => {
    const res = await userPATCH(adminReq('PATCH', 'http://localhost/x', { is_active: false }, 'master-pass'), { params: Promise.resolve({ id: UID }) });
    expect(res.status).toBe(200);
  });

  test('rejects missing master password header', async () => {
    const res = await userPATCH(adminReq('PATCH', 'http://localhost/x', { is_active: false }), { params: Promise.resolve({ id: UID }) });
    expect(res.status).toBe(401);
  });
});
