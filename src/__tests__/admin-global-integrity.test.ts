/** Global administrator configuration: validation, trusted identity and atomic RPC boundaries. */

process.env.ADMIN_TOKEN_SECRET = 'admin-test-secret-that-is-at-least-32-characters';
process.env.TOKEN_SECRET = 'user-test-secret-that-is-at-least-32-characters';

import { NextRequest } from 'next/server';
import { createAdminToken, createToken } from '@/lib/auth';
import { adminJsonError } from '@/lib/admin-guard';
import {
  mockClient, resetMock, setResult, setRpcResult, getRpcCalls, getCalls, findOp,
} from './helpers/supabase-mock';

jest.mock('@/lib/supabase-client', () => ({ getSupabase: () => mockClient }));

import { PUT as settingsPUT } from '@/app/api/admin/app-settings/route';
import { DELETE as settingDELETE } from '@/app/api/admin/app-settings/[key]/route';
import { POST as adPOST } from '@/app/api/admin/advertisements/route';
import { DELETE as paymentDELETE } from '@/app/api/admin/payment-methods/route';
import { PUT as supportPUT } from '@/app/api/admin/support/route';
import { GET as publicSettingsGET } from '@/app/api/app-settings/route';

const ADMIN = '90000000-0000-4000-8000-000000000001';
const AD = '91000000-0000-4000-8000-000000000001';
const METHOD = '92000000-0000-4000-8000-000000000001';
const TICKET = '93000000-0000-4000-8000-000000000001';

function req(body?: unknown, url = 'http://localhost/api/admin/test') {
  const token = createAdminToken(ADMIN);
  return {
    url,
    nextUrl: new URL(url),
    method: 'POST',
    headers: { get: () => null },
    cookies: { get: (key: string) => key === 'admin_token' ? { value: token } : undefined },
    json: async () => body,
  } as unknown as NextRequest;
}

function userReq() {
  const token = createToken('user-1', 'admin');
  return {
    url: 'http://localhost/api/app-settings', method: 'GET',
    headers: { get: (key: string) => key === 'authorization' ? `Bearer ${token}` : null },
    cookies: { get: () => undefined },
  } as unknown as NextRequest;
}

beforeEach(() => {
  resetMock();
  setResult('admin_users', 'maybeSingle', {
    id: ADMIN, email: 'root@example.test', name: 'Root', is_active: true, token_version: 0,
  });
});

describe('admin error boundary', () => {
  test('does not leak database/schema details to the browser', async () => {
    const log = jest.spyOn(console, 'error').mockImplementation(() => undefined);
    const res = adminJsonError({ message: 'column secret_hash does not exist', details: 'SQL statement' });
    const body = await res.json();
    expect(res.status).toBe(500);
    expect(body.message).toBe('حدث خطأ في الخادم');
    expect(body.errorId).toMatch(/^[a-z0-9]+$/);
    expect(JSON.stringify(body)).not.toContain('secret_hash');
    expect(JSON.stringify(body)).not.toContain('SQL statement');
    expect(log).toHaveBeenCalled();
    log.mockRestore();
  });
});

describe('global app settings', () => {
  test('rejects nested values before a database write', async () => {
    const res = await settingsPUT(req({ app_name: { injected: true } }));
    expect(res.status).toBe(400);
    expect(getRpcCalls()).toHaveLength(0);
  });

  test('bulk update uses the authenticated admin id in one audited RPC', async () => {
    setRpcResult('admin_upsert_app_settings', { updated: 2 });
    const updates = { app_name: 'Pro Acc', support_email: 'support@example.test' };
    const res = await settingsPUT(req(updates));
    expect(res.status).toBe(200);
    expect(getRpcCalls()).toEqual([{
      name: 'admin_upsert_app_settings', params: { p_admin_id: ADMIN, p_updates: updates },
    }]);
    expect(findOp('app_settings', 'upsert')).toBeNull();
  });

  test('built-in keys cannot be deleted', async () => {
    setRpcResult('admin_delete_app_setting', { protected: true });
    const res = await settingDELETE(req(undefined), { params: Promise.resolve({ key: 'app_name' }) });
    expect(res.status).toBe(400);
    expect(findOp('app_settings', 'delete')).toBeNull();
  });

  test('tenant-facing settings use an explicit key allow-list, not a phantom is_public column', async () => {
    setResult('users', 'single', { company_id: 'company-1', is_active: true, role: 'admin', token_version: 0 });
    setResult('companies', 'single', { is_active: true });
    setResult('subscriptions', 'maybeSingle', {
      status: 'active', end_date: '2099-01-01', plan_code: 'start',
      subscription_plans: { code: 'start', features_modules: {} },
    });
    setResult('app_settings', 'select', [{ key: 'app_name', value: 'Pro Acc' }]);
    const res = await publicSettingsGET(userReq());
    expect(res.status).toBe(200);
    expect((await res.json()).data).toEqual({ app_name: 'Pro Acc' });
    const query = getCalls().find((call) => call.table === 'app_settings')!;
    expect(query.ops.some((op) => op.op === 'in' && op.args[0] === 'key')).toBe(true);
    expect(query.ops.some((op) => op.args[0] === 'is_public')).toBe(false);
  });
});

describe('advertisements', () => {
  test('accepts UI enum values and delegates creation atomically', async () => {
    setRpcResult('admin_manage_advertisement', { id: AD, title: 'ترقية' });
    const res = await adPOST(req({
      title: 'ترقية', body: 'تفاصيل الترقية', type: 'upgrade', display_mode: 'modal',
      linkUrl: 'https://example.test/upgrade', showDuration: '7',
    }));
    expect(res.status).toBe(201);
    expect(getRpcCalls()[0]).toMatchObject({
      name: 'admin_manage_advertisement',
      params: {
        p_admin_id: ADMIN, p_action: 'create', p_ad_id: null,
        p_payload: { type: 'upgrade', display_mode: 'modal' },
      },
    });
    expect(findOp('advertisements', 'insert')).toBeNull();
  });

  test('blocks non-HTTP links before PostgreSQL', async () => {
    const res = await adPOST(req({ title: 'x', body: 'body', linkUrl: 'javascript:alert(1)' }));
    expect(res.status).toBe(400);
    expect(getRpcCalls()).toHaveLength(0);
  });
});

describe('payment methods and support', () => {
  test('payment deletion is a history-preserving deactivation RPC', async () => {
    setRpcResult('admin_manage_payment_method', { id: METHOD, deactivated: true });
    const res = await paymentDELETE(req(undefined, `http://localhost/api/admin/payment-methods?id=${METHOD}`));
    expect(res.status).toBe(200);
    expect(getRpcCalls()).toEqual([{
      name: 'admin_manage_payment_method',
      params: { p_admin_id: ADMIN, p_action: 'deactivate', p_method_id: METHOD, p_payload: {} },
    }]);
    expect(findOp('payment_methods', 'delete')).toBeNull();
  });

  test('support decision, customer notification and audit share one transaction', async () => {
    setRpcResult('admin_update_support_ticket', { id: TICKET, status: 'resolved' });
    const res = await supportPUT(req({ id: TICKET, status: 'resolved', admin_notes: 'تم الحل' }));
    expect(res.status).toBe(200);
    expect(getRpcCalls()).toEqual([{
      name: 'admin_update_support_ticket',
      params: {
        p_admin_id: ADMIN, p_ticket_id: TICKET, p_status: 'resolved',
        p_admin_notes: 'تم الحل', p_notes_set: true,
      },
    }]);
    expect(findOp('support_tickets', 'update')).toBeNull();
    expect(findOp('company_messages', 'insert')).toBeNull();
  });

  test('invalid support status is rejected before the RPC', async () => {
    const res = await supportPUT(req({ id: TICKET, status: 'hacked' }));
    expect(res.status).toBe(400);
    expect(getRpcCalls()).toHaveLength(0);
  });
});
