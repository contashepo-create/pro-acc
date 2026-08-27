process.env.TOKEN_SECRET = 'test-secret-key-for-unit-tests-32chars!';

import { 
  INVOICE_TEMPLATES, 
  getTemplateConfig, 
  DEFAULT_INVOICE_SETTINGS, 
  resolveInvoiceTitle 
} from '@/lib/invoice-templates';
import { createToken } from '@/lib/auth';
import type { TestBuilder } from './mocks';
import type { NextRequest } from 'next/server';

type Row = Record<string, unknown>;
type Op = { op: string; col?: string; val?: unknown };

function makeDb(db: Record<string, Row[]>) {
  const calls: Array<{ table: string; ops: Op[]; mut: { kind?: string; payload?: Row | Row[] } }> = [];

  const from = (table: string) => {
    const ops: Op[] = [];
    const mut: { kind?: string; payload?: Row | Row[] } = {};
    const call = { table, ops, mut };
    calls.push(call);

    const applyFilters = () =>
      (db[table] || []).filter((r) =>
        ops.every((o) => {
          if (o.op === 'eq') return r[o.col!] === o.val;
          if (o.op === 'neq') return r[o.col!] !== o.val;
          if (o.op === 'in') return (o.val as unknown[]).includes(r[o.col!]);
          if (o.op === 'is') return o.val === null ? r[o.col!] == null : r[o.col!] === o.val;
          if (o.op === 'gte') return (r[o.col!] as string) >= (o.val as string);
          if (o.op === 'lte') return (r[o.col!] as string) <= (o.val as string);
          if (o.op === 'lt') return (r[o.col!] as string) < (o.val as string);
          return true;
        })
      );

    const api: TestBuilder = {
      select: () => api,
      eq: (col: string, val: unknown) => { ops.push({ op: 'eq', col, val }); return api; },
      neq: (col: string, val: unknown) => { ops.push({ op: 'neq', col, val }); return api; },
      in: (col: string, val: unknown) => { ops.push({ op: 'in', col, val }); return api; },
      is: (col: string, val: unknown) => { ops.push({ op: 'is', col, val }); return api; },
      gte: (col: string, val: unknown) => { ops.push({ op: 'gte', col, val }); return api; },
      lte: (col: string, val: unknown) => { ops.push({ op: 'lte', col, val }); return api; },
      lt: (col: string, val: unknown) => { ops.push({ op: 'lt', col, val }); return api; },
      order: () => api,
      limit: () => api,
      insert: (payload: Row | Row[]) => { mut.kind = 'insert'; mut.payload = payload; return api; },
      update: (payload: Row) => { mut.kind = 'update'; mut.payload = payload; return api; },
      delete: () => { mut.kind = 'delete'; return api; },
      maybeSingle: async () => ({ data: applyFilters()[0] ?? null, error: null }),
      single: async () => {
        const row = applyFilters()[0] ?? null;
        return { data: row, error: row ? null : { message: 'not found' } };
      },
      then: <T1 = { data: unknown; error: unknown }, T2 = never>(
        onF?: ((v: { data: unknown; error: unknown }) => T1 | PromiseLike<T1>) | null,
        onR?: ((e: unknown) => T2 | PromiseLike<T2>) | null,
      ) => Promise.resolve({ data: applyFilters(), error: null }).then(onF ?? undefined, onR ?? undefined),
    };
    return api;
  };

  const rpcCalls: Array<{ name: string; params?: Row }> = [];
  const rpc = async (name: string, params?: Row): Promise<{ data: unknown; error: unknown }> => {
    rpcCalls.push({ name, params });
    if (name === 'get_equity_changes_summary') return {
      data: { periodRevenue: 50000, periodExpenses: 30000 }, error: null,
    };
    if (name === 'get_contact_balances') return {
      data: [
        { contact_id: 'c1', name: 'شركة الأفق', contact_type: 'client', opening: 0, period_debit: 50000, period_credit: 0, closing: 50000 },
        { contact_id: 's1', name: 'مؤسسة التوريدات', contact_type: 'supplier', opening: 0, period_debit: 20000, period_credit: 0, closing: 20000 },
      ], error: null,
    };
    if (name === 'get_account_period_totals') return {
      data: [
        { account_id: 'a-exp1', code: '5110', name: 'مواد خام', debit: 20000, credit: 0 },
        { account_id: 'a-exp2', code: '5210', name: 'رواتب وأجور', debit: 10000, credit: 0 },
      ], error: null,
    };
    return { data: null, error: { message: `missing ${name}` } };
  };
  return { from, calls, rpc, rpcCalls };
}

let mockDb: ReturnType<typeof makeDb>;

jest.mock('@/lib/supabase-client', () => ({ getSupabase: () => mockDb }));

import { GET as equityChangesGET } from '@/app/api/reports/equity-changes/route';
import { GET as contactBalancesGET } from '@/app/api/reports/contact-balances/route';
import { GET as expenseAnalysisGET } from '@/app/api/reports/expense-analysis/route';

const C1 = 'company-1';

function baseDb() {
  return {
    users: [{ id: 'u1', company_id: C1, is_active: true, token_version: 0, role: 'admin' }],
    subscriptions: [{ id: 's1', company_id: C1, status: 'active', end_date: '2099-01-01', plan_code: 'enterprise',
      subscription_plans: { code: 'enterprise', name: 'Enterprise', features_modules: {} } }],
    companies: [{ id: C1, is_active: true, token_version: 0 }],
    contacts: [
      { id: 'c1', company_id: C1, name: 'شركة الأفق', type: 'client', tax_number: '300000000000003', is_active: true, token_version: 0 },
      { id: 's1', company_id: C1, name: 'مؤسسة التوريدات', type: 'supplier', tax_number: '300000000000004', is_active: true, token_version: 0 },
    ],
    accounts: [
      { id: 'a-cap', company_id: C1, code: '3100', name: 'رأس المال', type: 'equity', is_active: true, token_version: 0 },
      { id: 'a-ret', company_id: C1, code: '3200', name: 'الأرباح المحتجزة', type: 'equity', is_active: true, token_version: 0 },
      { id: 'a-rev', company_id: C1, code: '4100', name: 'إيرادات عقود', type: 'revenue', is_active: true, token_version: 0 },
      { id: 'a-exp1', company_id: C1, code: '5110', name: 'مواد خام', type: 'expense', is_active: true, token_version: 0 },
      { id: 'a-exp2', company_id: C1, code: '5210', name: 'رواتب وأجور', type: 'expense', is_active: true, token_version: 0 },
    ],
    journal_entries: [
      { id: 'je-1', company_id: C1, date: '2026-01-15', type: 'general', deleted_at: null },
      { id: 'je-2', company_id: C1, date: '2026-02-10', type: 'general', deleted_at: null },
    ],
    journal_lines: [
      { id: 'jl-1', company_id: C1, journal_entry_id: 'je-1', account_id: 'a-rev', debit: 0, credit: 50000, contact_id: 'c1' },
      { id: 'jl-2', company_id: C1, journal_entry_id: 'je-1', account_id: 'a-exp1', debit: 20000, credit: 0, contact_id: 's1' },
      { id: 'jl-3', company_id: C1, journal_entry_id: 'je-2', account_id: 'a-exp2', debit: 10000, credit: 0 },
    ],
  };
}

function authedRequest(qs = '') {
  const token = createToken('u1', 'admin');
  return {
    url: `http://localhost/api/test${qs}`,
    headers: { get: (k: string) => (k === 'authorization' ? `Bearer ${token}` : null) },
    cookies: { get: () => undefined },
  } as unknown as NextRequest;
}

describe('Invoice Templates & ZATCA classification logic', () => {
  test('has 6 distinct layout templates with unique identifiers', () => {
    expect(INVOICE_TEMPLATES.length).toBeGreaterThanOrEqual(6);
    const ids = INVOICE_TEMPLATES.map(t => t.id);
    expect(ids).toContain('modern');
    expect(ids).toContain('classic');
    expect(ids).toContain('compact');
    expect(ids).toContain('elegant');
    expect(ids).toContain('construction');
    expect(ids).toContain('thermal');
    expect(getTemplateConfig('classic').layout).toBe('classic');
    expect(getTemplateConfig('missing').id).toBe(INVOICE_TEMPLATES[0].id);
    expect(DEFAULT_INVOICE_SETTINGS.invoiceType).toBe('auto');
  });

  test('resolveInvoiceTitle correctly resolves B2B (Standard) vs B2C (Simplified)', () => {
    // Auto mode with client VAT -> Standard Tax Invoice (B2B)
    const b2bInv = { client_tax_number: '300000000000003' };
    const b2bResult = resolveInvoiceTitle(b2bInv, 'auto');
    expect(b2bResult.titleAr).toBe('فاتورة ضريبية');
    expect(b2bResult.isSimplified).toBe(false);

    // Auto mode with cash consumer without VAT -> Simplified Tax Invoice (B2C)
    const b2cInv = { client_tax_number: null };
    const b2cResult = resolveInvoiceTitle(b2cInv);
    expect(resolveInvoiceTitle(b2cInv, 'auto')).toEqual(b2cResult);
    expect(b2cResult.titleAr).toBe('فاتورة ضريبية مبسطة');
    expect(resolveInvoiceTitle({ client_commercial_registration: 'CR' }, 'auto').isSimplified).toBe(false);
    expect(resolveInvoiceTitle({ contacts: { tax_number: 'VAT' } }, 'auto').isSimplified).toBe(false);
    expect(resolveInvoiceTitle({ contacts: { commercial_registration: 'CR' } }, 'auto').isSimplified).toBe(false);
    expect(resolveInvoiceTitle(null as never, 'auto').isSimplified).toBe(true);
    expect(b2cResult.isSimplified).toBe(true);

    // Explicit standard override
    const explicitStd = resolveInvoiceTitle(b2cInv, 'standard');
    expect(explicitStd.titleAr).toBe('فاتورة ضريبية');
    expect(explicitStd.isSimplified).toBe(false);

    // Explicit simplified override
    const explicitSimp = resolveInvoiceTitle(b2bInv, 'simplified');
    expect(explicitSimp.titleAr).toBe('فاتورة ضريبية مبسطة');
    expect(explicitSimp.isSimplified).toBe(true);
  });
});

describe('New Accounting Reports Endpoints', () => {
  test('GET /api/reports/equity-changes computes equity movements & net income', async () => {
    mockDb = makeDb(baseDb());
    const res = await equityChangesGET(authedRequest('?from=2026-01-01&to=2026-12-31'));
    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.success).toBe(true);
    expect(json.data.changes.net_income).toBe(20000); // 50,000 rev - 30,000 exp
    expect(json.data.ending.net_income).toBe(20000);
  });

  test('GET /api/reports/contact-balances calculates customer and supplier sub-ledger balances', async () => {
    mockDb = makeDb(baseDb());
    const res = await contactBalancesGET(authedRequest('?from=2026-01-01&to=2026-12-31'));
    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.success).toBe(true);
    expect(json.data.contacts.length).toBeGreaterThan(0);
  });

  test('GET /api/reports/expense-analysis breaks down expenses with percentages', async () => {
    mockDb = makeDb(baseDb());
    const res = await expenseAnalysisGET(authedRequest('?from=2026-01-01&to=2026-12-31'));
    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.success).toBe(true);
    expect(json.data.total_expense).toBe(30000); // 20k + 10k
    expect(json.data.categories).toHaveLength(2);
    expect(json.data.categories[0].percentage).toBeCloseTo(66.67, 1);
  });
});
