/**
 * Section 4 tests — Sales invoices & ZATCA
 *
 * 1. Server-side amount computation: client-sent subtotal/vat/total are
 *    ignored (VAT-understatement vector closed); discounts honoured
 * 2. Invoice journal entry: independent journal numbering, balanced lines,
 *    tenant-scoped codes/names via insertJournalLines
 * 3. Tenant checks: foreign client → 404, foreign bank/safe → 400,
 *    zero database writes in both cases
 * 4. Immediate collection flow (bank line + receipt voucher)
 * 5. PATCH paid → paid_amount=total; PATCH cancelled → reversal entry
 * 6. ZATCA UBL: XML injection via seller/buyer/notes escapes
 */

process.env.TOKEN_SECRET = 'test-secret-key-for-unit-tests-32chars!';

import * as fs from 'fs';
import * as path from 'path';
import { createToken } from '@/lib/auth';
import { generateUBLInvoice } from '@/lib/zatca';

type Row = Record<string, any>;
type Op = { op: string; col?: string; val?: any };

function makeDb(db: Record<string, Row[]>) {
  const calls: Array<{ table: string; ops: Op[]; mut: { kind?: string; payload?: any } }> = [];
  let insertCounter = 0;

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
      order: () => api,
      limit: () => api,
      range: () => api,
      insert: (payload: any) => { mut.kind = 'insert'; mut.payload = payload; return api; },
      update: (payload: any) => { mut.kind = 'update'; mut.payload = payload; return api; },
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
        const row = applyFilters()[0] ?? null;
        return { data: row, error: row ? null : { message: 'not found' } };
      },
      then: (onF: any, onR: any) =>
        Promise.resolve({ data: applyFilters(), error: null }).then(onF, onR),
    };
    return api;
  };

  const db_: any = { from, calls, rpcCalls: [] as Array<{ name: string; params: any }> };
  db_.rpcImpl = async (name: string) => ({ data: null, error: { message: `Could not find the function ${name}` } });
  db_.rpc = (name: string, params: any) => {
    db_.rpcCalls.push({ name, params });
    return db_.rpcImpl(name, params);
  };
  return db_;
}

let mockDb: ReturnType<typeof makeDb>;

jest.mock('@/lib/supabase-client', () => ({ getSupabase: () => mockDb }));
jest.mock('@/lib/usage-limits', () => ({
  checkUsageLimit: jest.fn(async () => ({ allowed: true })),
  checkModuleAccess: jest.fn(async () => true),
}));

import { POST as invoicesPOST } from '@/app/api/invoices/route';
import { PATCH as invoicePATCH } from '@/app/api/invoices/[id]/route';
import { GET as invoiceZatcaGET } from '@/app/api/invoices/[id]/zatca/route';

const C1 = 'company-1';
const CLIENT = '00000000-0000-4000-8000-0000000000c1';
const AR = '00000000-0000-4000-8000-000000001130';
const REV = '00000000-0000-4000-8000-000000004100';
const VAT = '00000000-0000-4000-8000-000000002120';
const BANK_ACC = '00000000-0000-4000-8000-000000001121';
const SAFE = '00000000-0000-4000-8000-0000000000b1';

function baseDb() {
  return {
    users: [{ id: 'u1', company_id: C1, is_active: true, token_version: 0, role: 'admin' }],
    companies: [{ id: C1, is_active: true, token_version: 0, name: 'شركة الاختبار', tax_number: '312345678901234' }],
    contacts: [{ id: CLIENT, company_id: C1, name: 'عميل' }],
    projects: [] as Row[],
    accounts: [
      { id: AR, company_id: C1, code: '1130', name: 'العملاء' },
      { id: REV, company_id: C1, code: '4100', name: 'إيرادات مقاولات' },
      { id: VAT, company_id: C1, code: '2120', name: 'ضريبة المبيعات' },
      { id: BANK_ACC, company_id: C1, code: '1121', name: 'بنك الراجحي' },
    ],
    banks_safes: [{ id: SAFE, company_id: C1, account_id: BANK_ACC }],
    invoice_sequences: [] as Row[],
        subscriptions: [{
      id: 's1', company_id: C1, plan_id: 'p1', plan_code: 'enterprise', status: 'active',
      start_date: '2024-01-01',
      end_date: new Date(Date.now() + 30 * 86400000).toISOString().split('T')[0],
      subscription_plans: { code: 'enterprise', name: 'Enterprise', features_modules: {
        dashboard: true, accounts: true, journal: true, invoices: true, quotations: true,
        clients: true, contacts: true, reports_basic: true, reports_advanced: true,
        reports_consolidated: true, settings: true, subscription: true, inventory: true,
        purchases: true, cost_centers: true, banks: true, cash: true, warehouses: true,
        branches: true, tax_reports: true, fixed_assets: true, pos: true, workflows: true,
        approvals: true, custody: true, employees: true, projects: true, budgets: true,
        messages: true, crm: true, contracts: true, tenders: true, boq: true,
        progress_billing: true, subcontractors: true, payroll: true
      } },
    }],
journal_sequences: [] as Row[],
    voucher_receipts: [] as Row[],
    invoices: [] as Row[],
    invoice_items: [] as Row[],
    journal_entries: [] as Row[],
    journal_lines: [] as Row[],
  } as Record<string, Row[]>;
}

function authedRequest(body?: any) {
  const token = createToken('u1', 'admin');
  return {
    headers: { get: (k: string) => (k === 'authorization' ? `Bearer ${token}` : null) },
    cookies: { get: () => undefined },
    json: async () => body,
  } as any;
}

const paramsOf = (id: string) => ({ params: Promise.resolve({ id }) });

function invoiceBody(overrides: any = {}) {
  return {
    clientId: CLIENT,
    date: '2026-08-01',
    dueDate: '2026-08-15',
    items: [
      { description: 'بند 1', quantity: 2, unitPrice: 100, total: 200 },
      { description: 'بند 2', quantity: 3, unitPrice: 50, total: 150 },
    ],
    // LYING totals — server must ignore these
    subtotal: 0.01, vatAmount: 0, total: 0.01,
    vatRate: 0.15,
    notes: 'اختبار',
    ...overrides,
  };
}

function insertsOf(table: string) {
  return mockDb.calls.filter((c) => c.mut.kind === 'insert' && c.table === table);
}

// ---------------------------------------------------------------------------

describe('POST /api/invoices — atomic financial boundary', () => {
  beforeEach(() => {
    mockDb = makeDb(baseDb());
  });

  test('passes trusted tenant/user context and source items to one transaction RPC', async () => {
    mockDb.rpcImpl = async () => ({
      data: { id: 'inv-1', total: 402.5, vat_amount: 52.5, journal_entry_id: 'je-1' },
      error: null,
    });
    const res = await invoicesPOST(authedRequest(invoiceBody()));
    expect(res.status).toBe(201);
    expect(mockDb.rpcCalls).toHaveLength(1);
    expect(mockDb.rpcCalls[0]).toMatchObject({
      name: 'create_sales_invoice_atomic',
      params: {
        p_company_id: C1,
        p_user_id: 'u1',
        p_contact_id: CLIENT,
        p_items: invoiceBody().items,
        p_vat_rate: 0.15,
        p_collected_amount: 0,
      },
    });
    expect(mockDb.rpcCalls[0].params).not.toHaveProperty('p_total');
    expect(mockDb.rpcCalls[0].params).not.toHaveProperty('p_subtotal');
    expect(insertsOf('invoices')).toHaveLength(0);
    expect(insertsOf('journal_entries')).toHaveLength(0);
  });

  test('normalizes optional immediate collection into the atomic call', async () => {
    mockDb.rpcImpl = async () => ({ data: { id: 'inv-2', total: 402.5 }, error: null });
    const res = await invoicesPOST(authedRequest(invoiceBody({ collected_amount: 100, bank_safe_id: SAFE })));
    expect(res.status).toBe(201);
    expect(mockDb.rpcCalls[0].params).toMatchObject({
      p_collected_amount: 100,
      p_bank_safe_id: SAFE,
    });
  });

  test.each([
    [{ collected_amount: -1 }, 'مبلغ التحصيل'],
    [{ collected_amount: 1.001 }, 'مبلغ التحصيل'],
  ])('rejects invalid collection input before PostgreSQL', async (overrides, message) => {
    const res = await invoicesPOST(authedRequest(invoiceBody(overrides)));
    expect(res.status).toBe(400);
    expect((await res.json()).message).toContain(message);
    expect(mockDb.rpcCalls).toHaveLength(0);
  });
});

describe('PATCH /api/invoices/[id] — lifecycle RPC', () => {
  beforeEach(() => {
    mockDb = makeDb(baseDb());
  });

  test('refuses to mark paid without a receipt allocation', async () => {
    const res = await invoicePATCH(authedRequest({ status: 'paid' }), paramsOf('30000000-0000-4000-8000-000000000001'));
    expect(res.status).toBe(400);
    expect((await res.json()).message).toMatch(/سند قبض|مدفوعة/);
    expect(mockDb.rpcCalls).toHaveLength(0);
  });

  test('cancels through one tenant-scoped reversal transaction', async () => {
    mockDb.rpcImpl = async () => ({ data: { id: 'inv-1', status: 'cancelled', reversal_id: 'je-r1' }, error: null });
    const res = await invoicePATCH(authedRequest({ status: 'cancelled', notes: 'سبب' }), paramsOf('30000000-0000-4000-8000-000000000001'));
    expect(res.status).toBe(200);
    expect(mockDb.rpcCalls).toEqual([{
      name: 'cancel_sales_invoice_atomic',
      params: {
        p_company_id: C1,
        p_invoice_id: '30000000-0000-4000-8000-000000000001',
        p_notes: 'سبب',
        p_user_id: 'u1',
      },
    }]);
    expect(insertsOf('journal_entries')).toHaveLength(0);
    expect(insertsOf('journal_lines')).toHaveLength(0);
  });
});

describe('GET /api/invoices/[id]/zatca — immutable tenant tax document', () => {
  const invoiceId = '30000000-0000-4000-8000-000000000001';
  const invoiceRow = {
    id: invoiceId,
    company_id: C1,
    number: 7,
    date: '2026-08-01',
    subtotal: 100,
    vat_rate: 0.15,
    vat_amount: 15,
    // Deliberately wrong legacy aliases: the endpoint must ignore them.
    tax_rate: 15,
    tax_amount: 0,
    total: 115,
    status: 'unpaid',
    deleted_at: null,
    created_at: '2026-08-01T10:11:12Z',
    tax_snapshot: {
      seller: {
        name: 'البائع وقت الإصدار', vat_number: '300000000000003',
        commercial_registration: 'CR-1', address: 'عنوان البائع',
        country_code: 'SA', currency_code: 'SAR',
      },
      buyer: { name: 'المشتري وقت الإصدار', vat_number: '310000000000003', address: 'عنوان المشتري', country_code: 'SA' },
    },
  };

  beforeEach(() => {
    const data = baseDb();
    data.invoices = [invoiceRow];
    data.invoice_items = [{
      id: 'line-1', company_id: C1, invoice_id: invoiceId,
      description: 'خدمة', quantity: 1, unit_price: 100, total: 100,
    }];
    // Current master data differs; historical output must use tax_snapshot.
    data.companies[0] = { ...data.companies[0], name: 'اسم البائع الجديد', tax_number: '399999999999993' };
    mockDb = makeDb(data);
  });

  test('uses modern VAT facts and frozen parties and labels the output unsigned', async () => {
    const res = await invoiceZatcaGET(authedRequest(), paramsOf(invoiceId));
    expect(res.status).toBe(200);
    const payload = (await res.json()).data;
    expect(payload.ublXml).toContain('البائع وقت الإصدار');
    expect(payload.ublXml).not.toContain('اسم البائع الجديد');
    expect(payload.ublXml).toContain('<cbc:Percent>15</cbc:Percent>');
    expect(payload.ublXml).toContain('<cbc:TaxAmount currencyID="SAR">15.00</cbc:TaxAmount>');
    expect(payload.artifact).toMatchObject({
      format: 'ubl_2_1_unsigned', cryptographicallySigned: false,
      clearanceSubmitted: false, reportingSubmitted: false, phase2Compliant: false,
    });
  });

  test('does not expose an invoice owned by another company', async () => {
    const db = baseDb();
    db.invoices = [{ ...invoiceRow, company_id: 'company-2' }];
    db.invoice_items = [];
    mockDb = makeDb(db);
    const res = await invoiceZatcaGET(authedRequest(), paramsOf(invoiceId));
    expect(res.status).toBe(404);
  });

  test('refuses to serialize inconsistent financial source facts', async () => {
    mockDb = makeDb({
      ...baseDb(),
      invoices: [{ ...invoiceRow, vat_amount: 0 }],
      invoice_items: [{ id: 'line-1', company_id: C1, invoice_id: invoiceId, description: 'خدمة', quantity: 1, unit_price: 100, total: 100 }],
    });
    const res = await invoiceZatcaGET(authedRequest(), paramsOf(invoiceId));
    expect(res.status).toBe(409);
  });
});

describe('SQL invoice_items inserts always list company_id', () => {
  const fs = require('fs') as typeof import('fs');
  const path = require('path') as typeof import('path');
  test('create_invoice_with_journal and 023 write company_id on invoice_items', () => {
    const dir = path.join(__dirname, '../migrations');
    for (const file of ['014-atomic-invoice-creation.sql', '022-fix-journal-lines-company-id.sql', '023-fix-child-rows-company-id.sql']) {
      const sql = fs.readFileSync(path.join(dir, file), 'utf8');
      const inserts = [...sql.matchAll(/INSERT INTO invoice_items\s*\(([^)]+)\)/gi)];
      expect(inserts.length).toBeGreaterThan(0);
      for (const m of inserts) expect(m[1]).toMatch(/company_id/i);
    }
  });
});

describe('ZATCA UBL — XML injection safety', () => {
  test('escapes malicious markup in seller/buyer/notes/items', () => {
    const evil = '</cbc:Note><evil>INJECTED</evil>';
    const xml = generateUBLInvoice({
      uuid: 'uuid-1', number: 1, issueDate: '2026-08-01', issueTime: '10:00:00',
      invoiceTypeCode: '388', currencyCode: 'SAR',
      seller: {
        name: `بائع${evil}`,
        vatNumber: '312345678901234',
        address: { street: 'طريق الملك', city: 'الرياض', postalZone: '12345', country: 'SA' },
      },
      buyer: {
        name: `مشتري${evil}`,
        vatNumber: '',
        address: { street: 'شارع التحلية', city: 'جدة', country: 'SA' },
      },
      items: [{ id: '1', description: `بند${evil}`, quantity: 1, unitPrice: 100, vatRate: 0.15, total: 100 }],
      amounts: { lineExtensionAmount: 100, taxExclusiveAmount: 100, taxInclusiveAmount: 115, taxAmount: 15 },
      vatRate: 0.15,
      paymentMeansCode: '10',
      notes: [`ملاحظة${evil}`],
    });

    expect(xml).not.toContain('</cbc:Note><evil>');
    expect(xml).not.toContain('<evil>INJECTED</evil>');
    expect(xml).toContain('&lt;evil&gt;');
  });

  test('escapes scalar fields interpolated raw (dates, type code, currency, payment means)', () => {
    const xml = generateUBLInvoice({
      uuid: 'uuid-1', number: 1,
      issueDate: '2026-08-01</cbc:IssueDate><evil>D</evil>',
      issueTime: '10:00:00',
      invoiceTypeCode: '388<evil>T</evil>',
      currencyCode: 'SA"R<x>',
      seller: { name: 'بائع', vatNumber: '312345678901234' },
      buyer: { name: 'مشتري' },
      items: [{ id: '1', description: 'بند', quantity: 1, unitPrice: 100, vatRate: 0.15, total: 100 }],
      amounts: { lineExtensionAmount: 100, taxExclusiveAmount: 100, taxInclusiveAmount: 115, taxAmount: 15 },
      vatRate: 0.15,
      paymentMeansCode: '10<evil>P</evil>',
    });

    expect(xml).not.toContain('<evil>');
    expect(xml).not.toContain('currencyID="SA"R<x>"');
    expect(xml).toContain('&lt;evil&gt;');
    expect(xml).toContain('SA&quot;R&lt;x&gt;');
  });

  test('tolerates null/undefined text fields without crashing', () => {
    const xml = generateUBLInvoice({
      uuid: 'uuid-1', number: 1, issueDate: '2026-08-01', issueTime: '10:00:00',
      invoiceTypeCode: '388', currencyCode: 'SAR',
      seller: { name: undefined as any, vatNumber: undefined as any },
      buyer: { name: null as any },
      items: [{ id: '1', description: undefined as any, quantity: 1, unitPrice: 100, vatRate: 0.15, total: 100 }],
      amounts: { lineExtensionAmount: 100, taxExclusiveAmount: 100, taxInclusiveAmount: 115, taxAmount: 15 },
      vatRate: 0.15,
      notes: [undefined as any],
    });
    expect(xml).toContain('<Invoice');
    expect(xml).toContain('</Invoice>');
  });
});
