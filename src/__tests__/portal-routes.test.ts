/**
 * Route-boundary tests for the customer portal: /api/portal/auth (magic link),
 * /api/portal/invoices, and /api/portal/invoices/[id].
 */
process.env.TOKEN_SECRET = 'test-secret-key-for-unit-tests-32chars!';
process.env.PORTAL_SECRET = 'portal-test-secret-at-least-32-characters-long!!';

const sendEmailMock = jest.fn();
jest.mock('@/lib/email', () => ({ sendEmail: (...args: unknown[]) => sendEmailMock(...args) }));

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
          if (o.op === 'neq') return get(o.col!) !== o.val;
          return true;
        })
      );
    const api: TestBuilder = {
      select: () => api,
      eq: (col: string, val: unknown) => { ops.push({ op: 'eq', col, val }); return api; },
      in: (col: string, val: unknown) => { ops.push({ op: 'in', col, val }); return api; },
      neq: (col: string, val: unknown) => { ops.push({ op: 'neq', col, val }); return api; },
      ilike: () => api, order: () => api, limit: () => api, range: () => api, is: () => api,
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
    from, calls, rpcResults,
    rpc: async (name: string) => rpcResults.get(name) || { data: null, error: null },
  };
}

let mockDb: ReturnType<typeof makeDb>;
jest.mock('@/lib/supabase-client', () => ({ getSupabase: () => mockDb }));

import { POST as portalAuthPOST } from '@/app/api/portal/auth/route';
import { GET as portalInvoicesGET } from '@/app/api/portal/invoices/route';
import { GET as portalInvoiceGET } from '@/app/api/portal/invoices/[id]/route';
import { createPortalToken } from '@/lib/portal-auth';
import type { TestBuilder } from './mocks';
import type { NextRequest } from 'next/server';

const C1 = '00000000-0000-4000-8000-000000000c01';
const CONTACT = '00000000-0000-4000-8000-00000000c0c1';
const INV = '00000000-0000-4000-8000-00000000c0d1';
const EMAIL = 'client@example.com';

function baseDb() {
  return { contacts: [], invoices: [], invoice_items: [], companies: [] } as Record<string, Row[]>;
}

beforeEach(() => { sendEmailMock.mockReset(); mockDb = makeDb(baseDb()); });

describe('portal/auth POST', () => {
  test('returns the generic message when no matching contact exists', async () => {
    const res = await portalAuthPOST({ url: 'http://localhost/api/portal/auth', nextUrl: new URL('http://localhost/api/portal/auth'), headers: { get: () => null }, json: async () => ({ email: EMAIL }) } as unknown as NextRequest);
    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.data.message).toContain('إذا كان البريد مسجلاً');
  });

  test('sends a magic link to each matching active contact', async () => {
    sendEmailMock.mockResolvedValue(true);
    mockDb = makeDb({ ...baseDb(), contacts: [
      { id: CONTACT, name: 'عميل', email: EMAIL, company_id: C1, type: 'client', is_active: true, deleted_at: null, companies: { is_active: true } },
    ] });
    const res = await portalAuthPOST({ url: 'http://localhost/api/portal/auth', nextUrl: new URL('http://localhost/api/portal/auth'), headers: { get: () => null }, json: async () => ({ email: EMAIL }) } as unknown as NextRequest);
    expect(res.status).toBe(200);
    expect(sendEmailMock).toHaveBeenCalledTimes(1);
  });

  test('rejects an invalid email shape', async () => {
    const res = await portalAuthPOST({ url: 'http://localhost/api/portal/auth', nextUrl: new URL('http://localhost/api/portal/auth'), headers: { get: () => null }, json: async () => ({ email: 'not-an-email' }) } as unknown as NextRequest);
    expect(res.status).toBe(400);
  });
});

describe('portal/invoices GET', () => {
  const portalToken = createPortalToken({ contactId: CONTACT, companyId: C1, email: EMAIL });

  test('rejects a missing/invalid portal token', async () => {
    const res = await portalInvoicesGET({ url: 'http://localhost/api/portal/invoices', headers: { get: () => null } } as unknown as NextRequest);
    expect(res.status).toBe(401);
  });

  test('rejects when the contact no longer matches', async () => {
    const res = await portalInvoicesGET({ url: 'http://localhost/api/portal/invoices', headers: { get: (k: string) => k === 'x-portal-token' ? portalToken : null } } as unknown as NextRequest);
    expect(res.status).toBe(401);
  });

  test('lists invoices for a valid contact', async () => {
    mockDb = makeDb({ ...baseDb(), contacts: [
      { id: CONTACT, email: EMAIL, company_id: C1, is_active: true, deleted_at: null, companies: { is_active: true } },
    ], invoices: [{ id: INV, company_id: C1, contact_id: CONTACT, number: 'INV-1', status: 'paid' }] });
    const res = await portalInvoicesGET({ url: 'http://localhost/api/portal/invoices', headers: { get: (k: string) => k === 'x-portal-token' ? portalToken : null } } as unknown as NextRequest);
    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.data.invoices).toHaveLength(1);
  });
});

describe('portal/invoices/[id] GET', () => {
  const portalToken = createPortalToken({ contactId: CONTACT, companyId: C1, email: EMAIL });

  test('rejects an invalid portal token', async () => {
    const res = await portalInvoiceGET({ url: 'http://localhost/x', headers: { get: () => null } } as any, { params: Promise.resolve({ id: INV }) });
    expect(res.status).toBe(401);
  });

  test('rejects a malformed invoice id', async () => {
    mockDb = makeDb({ ...baseDb(), contacts: [{ id: CONTACT, email: EMAIL, company_id: C1, is_active: true, deleted_at: null, companies: { is_active: true } }] });
    const res = await portalInvoiceGET({ url: 'http://localhost/x', headers: { get: (k: string) => k === 'x-portal-token' ? portalToken : null } } as any, { params: Promise.resolve({ id: 'bad' }) });
    expect(res.status).toBe(400);
  });

  test('returns 404 for an unknown invoice', async () => {
    mockDb = makeDb({ ...baseDb(), contacts: [{ id: CONTACT, email: EMAIL, company_id: C1, is_active: true, deleted_at: null, companies: { is_active: true } }] });
    const res = await portalInvoiceGET({ url: 'http://localhost/x', headers: { get: (k: string) => k === 'x-portal-token' ? portalToken : null } } as any, { params: Promise.resolve({ id: INV }) });
    expect(res.status).toBe(404);
  });

  test('returns invoice detail with items and historical company', async () => {
    mockDb = makeDb({ ...baseDb(), contacts: [{ id: CONTACT, email: EMAIL, company_id: C1, is_active: true, deleted_at: null, companies: { is_active: true } }],
      invoices: [{ id: INV, company_id: C1, contact_id: CONTACT, number: 'INV-1', status: 'paid', tax_snapshot: { seller: { name: 'شركة س', vat_number: '123' } } }],
      invoice_items: [{ id: 'it1', invoice_id: INV, company_id: C1, description: 'x', quantity: 1, unit_price: 5, total: 5 }],
      companies: [{ id: C1, is_active: true, name: 'شركة', tax_number: '0', address: 'a', phone: '1', logo_url: null }] });
    const res = await portalInvoiceGET({ url: 'http://localhost/x', headers: { get: (k: string) => k === 'x-portal-token' ? portalToken : null } } as any, { params: Promise.resolve({ id: INV }) });
    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.data.items).toHaveLength(1);
    expect(json.data.company.name).toBe('شركة س');
  });
});
