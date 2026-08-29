/** Tenant subscription/support writes use trusted identity and atomic RPCs. */

process.env.TOKEN_SECRET = 'tenant-entitlement-test-secret-32-characters';

// The DB-backed share of the per-user rate limit is out of scope for these
// suites (the memory fast path is what they exercise); the authoritative
// store is covered by shared-rate-limit.test.ts + the 077 migration smoke.
jest.mock('@/lib/shared-rate-limit', () => ({ hitSharedRateLimit: async () => ({ allowed: true, retryAfterSeconds: 0 }) }));
import { NextRequest } from 'next/server';
import { createToken } from '@/lib/auth';
import {
  mockClient, resetMock, setResult, setRpcResult, getRpcCalls, findOp, callsForTable,
} from './helpers/supabase-mock';

jest.mock('@/lib/supabase-client', () => ({ getSupabase: () => mockClient }));

import { POST as supportPOST } from '@/app/api/support/route';
import { GET as addonGET, POST as addonPOST } from '@/app/api/subscription/addon-request/route';
import { POST as upgradePOST } from '@/app/api/subscription/upgrade-request/route';

const COMPANY = '90000000-0000-4000-8000-000000000001';
const USER = '91000000-0000-4000-8000-000000000001';
const PLAN = '92000000-0000-4000-8000-000000000001';

function req(body?: unknown, method = 'POST') {
  const token = createToken(USER, 'admin');
  const url = 'http://localhost/api/subscription/test';
  return {
    url,
    nextUrl: new URL(url),
    method,
    headers: { get: (key: string) => key === 'authorization' ? `Bearer ${token}` : null },
    cookies: { get: () => undefined },
    json: async () => body,
  } as unknown as NextRequest;
}

beforeEach(() => {
  resetMock();
  setResult('users', 'single', {
    id: USER, company_id: COMPANY, role: 'admin', is_active: true, token_version: 0,
  });
  setResult('companies', 'single', { id: COMPANY, is_active: true });
  setResult('subscriptions', 'maybeSingle', {
    id: 'sub-1', company_id: COMPANY, status: 'active', plan_code: 'start',
    end_date: '2099-01-01', subscription_plans: { code: 'start', features_modules: { subscription: true } },
  });
});

describe('tenant support', () => {
  test('ticket, admin message and audit use one tenant-aware RPC', async () => {
    setRpcResult('create_support_ticket_atomic', { id: 'ticket-1', status: 'open' });
    const res = await supportPOST(req({
      subject: 'مشكلة دفع', message: 'هذه تفاصيل مشكلة الدفع الحالية', category: 'payment',
    }));
    expect(res.status).toBe(201);
    expect(getRpcCalls()).toEqual([{
      name: 'create_support_ticket_atomic',
      params: {
        p_company_id: COMPANY, p_user_id: USER, p_subject: 'مشكلة دفع',
        p_message: 'هذه تفاصيل مشكلة الدفع الحالية', p_category: 'payment', p_attachment_url: null,
      },
    }]);
    expect(findOp('support_tickets', 'insert')).toBeNull();
    expect(findOp('company_messages', 'insert')).toBeNull();
  });
});

describe('tenant add-on requests', () => {
  test('server pricing, duplicate protection, message and audit stay in one RPC (receipt via Telegram)', async () => {
    setRpcResult('create_addon_request_atomic', { id: 'addon-1', status: 'pending', total_amount_usd: 10 });
    const res = await addonPOST(req({
      addon_type: 'extra_user', quantity: 2, duration_type: 'monthly',
      payment_method_code: 'bank', payment_date: '2026-08-15', payment_time: '12:30',
      notes: 'paid',
    }));
    expect(res.status).toBe(201);
    expect(getRpcCalls()).toEqual([{
      name: 'create_addon_request_atomic',
      params: {
        p_company_id: COMPANY, p_user_id: USER, p_addon_type: 'extra_user', p_quantity: 2,
        p_duration_type: 'monthly', p_payment_method_code: 'bank', p_payment_date: '2026-08-15',
        p_payment_time: '12:30', p_receipt_image_url: null, p_notes: 'paid',
      },
    }]);
    expect(findOp('addon_requests', 'insert')).toBeNull();
    expect(findOp('company_messages', 'insert')).toBeNull();
  });

  test('listing is scoped to both trusted company and current user', async () => {
    setResult('addon_requests', 'select', []);
    const res = await addonGET(req(undefined, 'GET'));
    expect(res.status).toBe(200);
    const call = callsForTable('addon_requests')[0];
    expect(call.ops).toEqual(expect.arrayContaining([
      { op: 'eq', args: ['company_id', COMPANY] },
      { op: 'eq', args: ['user_id', USER] },
    ]));
  });
});

describe('tenant upgrade requests', () => {
  test('catalogue price and tenant relationship are revalidated in one RPC (receipt via Telegram)', async () => {
    setRpcResult('create_upgrade_request_atomic', { id: 'upgrade-1', status: 'pending', plan_code: 'pro' });
    const res = await upgradePOST(req({
      requested_plan_id: PLAN, duration_type: 'monthly', payment_method_code: 'bank',
      payment_amount: 25, payment_date: '2026-08-15', payment_time: '13:00',
      notes: 'paid',
    }));
    expect(res.status).toBe(201);
    expect(getRpcCalls()).toEqual([{
      name: 'create_upgrade_request_atomic',
      params: {
        p_company_id: COMPANY, p_user_id: USER, p_requested_plan_id: PLAN,
        p_duration_type: 'monthly', p_payment_method_code: 'bank', p_payment_amount: 25,
        p_payment_date: '2026-08-15', p_payment_time: '13:00',
        p_receipt_image_url: null, p_notes: 'paid',
      },
    }]);
    expect(findOp('upgrade_requests', 'insert')).toBeNull();
    expect(findOp('company_messages', 'insert')).toBeNull();
  });

  test('rejects malformed plan ids before touching PostgreSQL', async () => {
    const res = await upgradePOST(req({
      requested_plan_id: 'not-a-uuid', duration_type: 'monthly', payment_method_code: 'bank',
    }));
    expect(res.status).toBe(400);
    expect(getRpcCalls()).toHaveLength(0);
  });
});
