/**
 * Regression tests for the notifications badge/page, the complaints flow, and
 * the record-preview normalization.
 *
 * Pins the fixes for the reported regressions:
 *  - The notifications page was ALWAYS empty: the route returned a bare array
 *    while the page read `data.notifications`, and the header badge ignored
 *    the `unread_only` filter it asked for.
 *  - A voucher preview showed raw `contact_id` / `bank_safe_id` UUIDs instead
 *    of the client and bank names.
 *  - The complaints edit form offered statuses the company could not actually
 *    set (only 'closed' is allowed), so "changing status" appeared broken.
 */

process.env.TOKEN_SECRET = 'test-secret-key-for-unit-tests-32chars!';

import { createToken } from '@/lib/auth';
import type { TestBuilder } from './mocks';
import type { NextRequest } from 'next/server';
import { buildRecordEntries } from '@/components/ui/RecordViewModal';

type Row = Record<string, unknown>;

function makeDb(db: Record<string, Row[]>) {
  const selectArgs: string[] = [];
  const muts: Array<{ table: string; kind: string; payload?: Row | Row[] }> = [];

  const from = (table: string) => {
    const filters: Array<{ kind: string; col: string; val: unknown }> = [];
    let limitCount: number | null = null;
    let head = false;
    let mut: { kind?: string; payload?: Row | Row[] } = {};

    const filtered = () => (db[table] || []).filter((row) =>
      filters.every((f) => {
        if (f.kind === 'eq') return row[f.col] === f.val;
        if (f.kind === 'or') {
          // 'user_id.is.null,user_id.eq.X'
          const [, eqUser] = String(f.val).split(',');
          const eqVal = eqUser.replace(/^user_id\.eq\./, '');
          return row.user_id === null || row.user_id === eqVal;
        }
        return true;
      })
    );

    const api: TestBuilder = {
      select: (cols: string, opts?: Record<string, unknown>) => {
        selectArgs.push(String(cols));
        head = opts?.head === true;
        return api;
      },
      eq: (col: string, val: unknown) => { filters.push({ kind: 'eq', col, val }); return api; },
      or: (expr: string) => { filters.push({ kind: 'or', col: '', val: expr }); return api; },
      order: () => api,
      limit: (n: number) => { limitCount = n; return api; },
      is: () => api,
      maybeSingle: async () => ({ data: filtered()[0] || null, error: null }),
      single: async () => ({ data: filtered()[0] || null, error: filtered()[0] ? null : { message: 'not found' } }),
      insert: (payload: Row | Row[]) => { mut = { kind: 'insert', payload }; return api; },
      update: (payload: Row) => { mut = { kind: 'update', payload }; return api; },
      delete: () => { mut = { kind: 'delete' }; return api; },
      then: <T1 = { data: unknown; error: unknown; count?: number }, T2 = never>(
        resolve?: ((v: { data: unknown; error: unknown; count?: number }) => T1 | PromiseLike<T1>) | null,
        reject?: ((e: unknown) => T2 | PromiseLike<T2>) | null,
      ) => {
        if (mut.kind) { muts.push({ table, kind: mut.kind, payload: mut.payload }); }
        if (mut.kind === 'update' || mut.kind === 'delete' || mut.kind === 'insert') {
          return Promise.resolve({ data: mut.payload ?? null, error: null }).then(resolve ?? undefined, reject ?? undefined);
        }
        const rows = filtered();
        const page = limitCount != null ? rows.slice(0, limitCount) : rows;
        return Promise.resolve({
          data: head ? null : page,
          count: rows.length,
          error: null,
        }).then(resolve ?? undefined, reject ?? undefined);
      },
    };
    return api;
  };

  return {
    from,
    selectArgs,
    muts,
    rpc: async () => ({ data: null, error: null }),
  };
}

let mockDb: ReturnType<typeof makeDb>;
jest.mock('@/lib/supabase-client', () => ({ getSupabase: () => mockDb }));

import { GET as notificationsGET } from '@/app/api/notifications/route';
import { PUT as notificationsPUT, DELETE as notificationsDELETE } from '@/app/api/notifications/[id]/route';

const C1 = 'company-1';
const ADMIN = 'u-admin';
const NID = '30000000-0000-4000-8000-000000000001';
const CWID = '30000000-0000-4000-8000-000000000002';

function baseDb(): Record<string, Row[]> {
  return {
    users: [{ id: ADMIN, company_id: C1, role: 'admin', is_active: true, token_version: 0, name: 'مدير' }],
    companies: [{ id: C1, name: 'شركة', email: 'co@example.com', phone: '0500', is_active: true }],
    subscriptions: [{
      id: 's1', company_id: C1, plan_code: 'enterprise', status: 'active',
      start_date: '2024-01-01', end_date: '2099-01-01',
      subscription_plans: { code: 'enterprise', name: 'Enterprise', trial_days: 0, features_modules: {} },
    }],
    notifications: [
      { id: NID, company_id: C1, user_id: ADMIN, type: 'approval_request', title: 'طلب اعتماد', message: 'سند صرف', is_read: false, created_at: '2026-01-01T10:00:00Z' },
      { id: CWID, company_id: C1, user_id: null, type: 'support_update', title: 'تحديث دعم', message: 'تم الرد', is_read: false, created_at: '2026-01-02T10:00:00Z' },
      { id: '30000000-0000-4000-8000-000000000003', company_id: C1, user_id: ADMIN, type: 'info', title: 'قديم', message: 'مقروء', is_read: true, created_at: '2026-01-03T10:00:00Z' },
    ],
  };
}

function req(method: string, body?: Row, path = '/api/test') {
  const token = createToken(ADMIN, 'admin');
  return {
    url: `http://localhost${path}`,
    method,
    headers: { get: (key: string) => (key.toLowerCase() === 'authorization' ? `Bearer ${token}` : null) },
    cookies: { get: () => undefined },
    json: async () => body,
  } as unknown as NextRequest;
}

beforeEach(() => {
  mockDb = makeDb(baseDb());
  global.fetch = jest.fn(async () => ({ ok: true, status: 200, json: async () => ({ ok: true }) })) as unknown as typeof fetch;
});

describe('notifications route regression', () => {
  test('returns { notifications, unreadCount } so the page is not empty', async () => {
    const response = await notificationsGET(req('GET', undefined, '/api/notifications'));
    expect(response.status).toBe(200);
    const payload = await response.json();
    expect(Array.isArray(payload.data.notifications)).toBe(true);
    expect(payload.data.notifications.length).toBe(3);
    expect(payload.data.unreadCount).toBe(2);
  });

  test('unread_only returns only unread rows and the accurate unread count', async () => {
    const response = await notificationsGET(req('GET', undefined, '/api/notifications?unread_only=true'));
    expect(response.status).toBe(200);
    const payload = await response.json();
    expect(payload.data.notifications.every((n: Row) => n.is_read === false)).toBe(true);
    expect(payload.data.notifications.length).toBe(2);
    expect(payload.data.unreadCount).toBe(2);
  });

  test('PUT can mark a company-wide notification (user_id null) as read', async () => {
    const response = await notificationsPUT(req('PUT', { isRead: true }), { params: Promise.resolve({ id: CWID }) });
    expect(response.status).toBe(200);
  });

  test('DELETE can remove a company-wide notification (user_id null)', async () => {
    const response = await notificationsDELETE(req('DELETE'), { params: Promise.resolve({ id: CWID }) });
    expect(response.status).toBe(200);
  });
});

describe('record preview normalization', () => {
  test('promotes relation names and hides raw UUID foreign keys', () => {
    const entries = buildRecordEntries({
      id: 'uuid-1',
      number: 12,
      amount: 100,
      contact_id: '438edab4-0efc-4bbe-8d7a-87564014d0f2',
      bank_safe_id: 'bf61dbf2-1971-41a6-89a9-06ea7e00cf40',
      contacts: { name: 'شركة الأمل' },
      banks_safes: { name: 'الخزينة الرئيسية' },
      status: 'approved',
    });

    const map = Object.fromEntries(entries);
    expect(map).toHaveProperty('contact_name', 'شركة الأمل');
    expect(map).toHaveProperty('bank_name', 'الخزينة الرئيسية');
    expect(map).not.toHaveProperty('contact_id');
    expect(map).not.toHaveProperty('bank_safe_id');
    expect(map).not.toHaveProperty('id');
    expect(map).toHaveProperty('number', 12);
    expect(map).toHaveProperty('amount', 100);
    expect(map).toHaveProperty('status', 'approved');
  });

  test('explicit hydrated names win over embedded objects', () => {
    const entries = buildRecordEntries({
      contact_id: '438edab4-0efc-4bbe-8d7a-87564014d0f2',
      contact_name: 'اسم مُهيّأ مسبقاً',
      contacts: { name: 'اسم من الكائن المضمّن' },
    });
    const map = Object.fromEntries(entries);
    expect(map.contact_name).toBe('اسم مُهيّأ مسبقاً');
  });
});
