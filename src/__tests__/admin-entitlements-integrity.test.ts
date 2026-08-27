/** Global subscription and communication administration stays validated and atomic. */

process.env.ADMIN_TOKEN_SECRET = 'admin-test-secret-that-is-at-least-32-characters';
process.env.TOKEN_SECRET = 'user-test-secret-that-is-at-least-32-characters';

import { NextRequest } from 'next/server';
import { createAdminToken } from '@/lib/auth';
import {
  mockClient, resetMock, setResult, setRpcResult, getRpcCalls, findOp,
} from './helpers/supabase-mock';

jest.mock('@/lib/supabase-client', () => ({ getSupabase: () => mockClient }));

import { POST as planPOST } from '@/app/api/admin/subscription-plans/route';
import { PUT as planPUT } from '@/app/api/admin/subscription-plans/[id]/route';
import { PATCH as complaintPATCH } from '@/app/api/admin/complaints/route';
import { POST as messagePOST } from '@/app/api/admin/messages/route';
import { PUT as addonPUT } from '@/app/api/admin/addon-requests/route';
import { PUT as upgradePUT } from '@/app/api/admin/upgrade-requests/route';

const ADMIN = '90000000-0000-4000-8000-000000000001';
const PLAN = '91000000-0000-4000-8000-000000000001';
const COMPANY = '92000000-0000-4000-8000-000000000001';
const COMPLAINT = '93000000-0000-4000-8000-000000000001';
const REQUEST = '94000000-0000-4000-8000-000000000001';

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

beforeEach(() => {
  resetMock();
  setResult('admin_users', 'maybeSingle', {
    id: ADMIN, email: 'root@example.test', name: 'Root', is_active: true, token_version: 0,
  });
});

describe('subscription plan administration', () => {
  test('rejects null or coerced non-numeric limits before PostgreSQL', async () => {
    const nullLimit = await planPOST(req({ code: 'secure', name: 'Secure', max_users: null }));
    expect(nullLimit.status).toBe(400);
    setResult('admin_users', 'maybeSingle', {
      id: ADMIN, email: 'root@example.test', name: 'Root', is_active: true, token_version: 0,
    });
    const booleanPrice = await planPOST(req({ code: 'secure', name: 'Secure', price_monthly: false }));
    expect(booleanPrice.status).toBe(400);
    expect(getRpcCalls()).toHaveLength(0);
  });

  test('normalizes plan data and delegates create to one audited RPC', async () => {
    setRpcResult('admin_manage_subscription_plan', { id: PLAN, code: 'secure' });
    const res = await planPOST(req({
      code: 'Secure', name: ' Secure plan ', currency: 'USD', priceMonthly: '25.50',
      maxUsers: '5', maxProjects: '10', features: ['accounts'],
      features_modules: { accounts: true },
    }));
    expect(res.status).toBe(201);
    expect(getRpcCalls()).toEqual([{
      name: 'admin_manage_subscription_plan',
      params: expect.objectContaining({
        p_admin_id: ADMIN, p_action: 'create', p_plan_id: null,
        p_payload: expect.objectContaining({ code: 'secure', name: 'Secure plan', price_monthly: 25.5, max_users: 5 }),
      }),
    }]);
    expect(findOp('subscription_plans', 'insert')).toBeNull();
  });

  test('requires a strict UUID before a plan update RPC', async () => {
    const res = await planPUT(req({ name: 'Changed' }), { params: Promise.resolve({ id: 'aaaaaaaa--------bbbb' }) });
    expect(res.status).toBe(400);
    expect(getRpcCalls()).toHaveLength(0);
  });
});

describe('complaints and outbound messages', () => {
  test('complaint response and audit are delegated to one RPC', async () => {
    setRpcResult('admin_update_complaint', { id: COMPLAINT, status: 'replied' });
    const res = await complaintPATCH(req({ id: COMPLAINT, adminReply: 'تمت المراجعة' }));
    expect(res.status).toBe(200);
    expect(getRpcCalls()).toEqual([{
      name: 'admin_update_complaint',
      params: {
        p_admin_id: ADMIN, p_complaint_id: COMPLAINT, p_status: null,
        p_reply: 'تمت المراجعة', p_reply_set: true,
      },
    }]);
    expect(findOp('complaints', 'update')).toBeNull();
  });

  test('company message and audit are delegated to one RPC', async () => {
    setRpcResult('admin_send_company_message', { id: '95000000-0000-4000-8000-000000000001' });
    const res = await messagePOST(req({ companyId: COMPANY, subject: ' تنبيه ', body: ' نص الرسالة ' }));
    expect(res.status).toBe(201);
    expect(getRpcCalls()).toEqual([{
      name: 'admin_send_company_message',
      params: { p_admin_id: ADMIN, p_company_id: COMPANY, p_subject: 'تنبيه', p_body: 'نص الرسالة' },
    }]);
    expect(findOp('messages', 'insert')).toBeNull();
  });
});

describe('entitlement decisions', () => {
  test('add-on decision does not issue a best-effort route notification', async () => {
    setRpcResult('review_addon_request', { id: REQUEST, status: 'approved' });
    const res = await addonPUT(req({ id: REQUEST, status: 'approved', admin_notes: 'paid' }));
    expect(res.status).toBe(200);
    expect(getRpcCalls()[0]).toEqual({
      name: 'review_addon_request',
      params: { p_request_id: REQUEST, p_admin_id: ADMIN, p_decision: 'approved', p_notes: 'paid' },
    });
    expect(findOp('company_messages', 'insert')).toBeNull();
  });

  test('upgrade decision does not issue a best-effort route notification', async () => {
    setRpcResult('review_upgrade_request', { id: REQUEST, status: 'rejected' });
    const res = await upgradePUT(req({ id: REQUEST, status: 'rejected' }));
    expect(res.status).toBe(200);
    expect(getRpcCalls()[0]).toEqual({
      name: 'review_upgrade_request',
      params: { p_request_id: REQUEST, p_admin_id: ADMIN, p_decision: 'rejected', p_notes: null },
    });
    expect(findOp('company_messages', 'insert')).toBeNull();
  });

  test('malformed request identifiers are rejected consistently', async () => {
    const res = await upgradePUT(req({ id: '12345678--------', status: 'approved' }));
    expect(res.status).toBe(400);
    expect(getRpcCalls()).toHaveLength(0);
  });
});
