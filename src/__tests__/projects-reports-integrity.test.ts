/**
 * Section 9 tests — Projects & Financial reports
 *
 * Critical fixes covered:
 * 1. Project creation stopped auto-creating a duplicate control account (1130)
 *    for the cash customer — that corrupted the chart and broke resolveAccountId.
 * 2. The auto-invoice path now posts a balanced, enriched JE (control account
 *    1130 tagged with contact_id + project_id) via createJournalEntry, with
 *    rollback and tenant checks. Previously it inserted raw lines without
 *    company_id/account_code and relied on contact.account_id (always null).
 * 3. projects/costs no longer double-counts lines (it summed via
 *    journal_entries.project_id AND journal_lines.project_id) and is now
 *    company-scoped with a tenant check.
 * 4. Project PUT/DELETE are company-scoped; DELETE blocks when JE-linked.
 * 5. Financial report excludes soft-deleted journal entries.
 */

process.env.TOKEN_SECRET = 'test-secret-key-for-unit-tests-32chars!';

import { createToken } from '@/lib/auth';

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
          if (o.op === 'gt') return (Number(r[o.col!]) || 0) > (Number(o.val) || 0);
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
        if (mut.kind === 'delete') {
          return { data: applyFilters()[0] ?? { deleted: true }, error: null };
        }
        const row = applyFilters()[0] ?? null;
        return { data: row, error: row ? null : { message: 'not found' } };
      },
      then: (onF: any, onR: any) =>
        Promise.resolve({ data: applyFilters(), error: null }).then(onF, onR),
    };
    return api;
  };

  const db_: any = { from, calls };
  db_.rpcImpl = async (name: string) => ({ data: null, error: { message: `missing ${name}` } });
  db_.rpc = (name: string, params: any) => db_.rpcImpl(name, params);
  return db_;
}

let mockDb: ReturnType<typeof makeDb>;

jest.mock('@/lib/supabase-client', () => ({ getSupabase: () => mockDb }));

import { POST as projectPOST } from '@/app/api/projects/route';
import { DELETE as projectDELETE } from '@/app/api/projects/[id]/route';
import { GET as projectCostsGET } from '@/app/api/projects/costs/route';
import { GET as financialReportGET } from '@/app/api/reports/financial/route';

const C1 = 'company-1';
const C2 = 'company-2';
const CLIENT = '00000000-0000-4000-8000-000000000c01';
const FOREIGN_CLIENT = '00000000-0000-4000-8000-000000000c99';
const AR = '00000000-0000-4000-8000-000000001130';
const REVENUE = '00000000-0000-4000-8000-000000004100';
const EXPENSE = '00000000-0000-4000-8000-000000005100';
const PROJ = '00000000-0000-4000-8000-000000000p01';
const FOREIGN_PROJ = '00000000-0000-4000-8000-000000000p99';

function baseDb() {
  return {
    users: [{ id: 'u1', company_id: C1, is_active: true, token_version: 0, role: 'admin' }],
    contacts: [
      { id: CLIENT, company_id: C1, name: 'عميل', type: 'client', account_id: null },
      { id: FOREIGN_CLIENT, company_id: C2, name: 'أجنبي', type: 'client' },
    ],
    accounts: [
      { id: AR, company_id: C1, code: '1130', name: 'العملاء', type: 'asset', is_active: true, token_version: 0 },
      { id: REVENUE, company_id: C1, code: '4100', name: 'إيرادات', type: 'revenue', is_active: true, token_version: 0 },
      { id: EXPENSE, company_id: C1, code: '5100', name: 'تكاليف', type: 'expense', is_active: true, token_version: 0 },
    ],
    projects: [] as Row[],
    boq_items: [] as Row[],
    invoices: [] as Row[],
    invoice_items: [] as Row[],
    journal_entries: [] as Row[],
    journal_lines: [] as Row[],
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
  } as Record<string, Row[]>;
}

function authedRequest(body?: any, method = 'POST') {
  const token = createToken('u1', 'admin');
  return {
    url: 'http://localhost/api/test',
    method,
    headers: { get: (k: string) => (k === 'authorization' ? `Bearer ${token}` : null) },
    cookies: { get: () => undefined },
    json: async () => body,
  } as any;
}

const paramsOf = (id: string) => ({ params: Promise.resolve({ id }) });
const urlOf = (qs = '') => `http://localhost/api/test${qs}`;
const withUrl = (req: any, qs = '') => ({ ...req, url: urlOf(qs) });
const insertsOf = (t: string) => mockDb.calls.filter((c) => c.mut.kind === 'insert' && c.table === t);
const deletesOf = (t: string) => mockDb.calls.filter((c) => c.mut.kind === 'delete' && c.table === t);

// ---------------------------------------------------------------------------

describe('projects POST — cash customer no longer corrupts the chart', () => {
  test('creating a project without a client does NOT insert a duplicate 1130 account', async () => {
    mockDb = makeDb(baseDb());
    const res = await projectPOST(authedRequest({
      name: 'مشروع نقدي', contract_value: 500, start_date: '2026-01-15',
    }));
    expect(res.status).toBe(201);
    // was: insert into accounts with code '1130' (duplicate control account)
    expect(insertsOf('accounts')).toHaveLength(0);
    // a cash-customer contact IS created
    const contactInsert = insertsOf('contacts')[0];
    expect(contactInsert).toBeTruthy();
    expect(contactInsert.mut.payload.name).toBe('عميل نقدي');
    expect(contactInsert.mut.payload.company_id).toBe(C1);
  });
});

describe('projects POST — auto-invoice posts a proper balanced JE', () => {
  test('JE: Dr AR (contact_id+project_id) / Cr revenue; lines carry company_id', async () => {
    mockDb = makeDb(baseDb());
    const res = await projectPOST(authedRequest({
      name: 'مشروع مفوتر', client_id: CLIENT, contract_value: 1000, start_date: '2026-01-15',
      auto_invoice: true,
      items: [{ description: 'بند', quantity: 1, unit_price: 1000, total: 1000 }],
    }));
    expect(res.status).toBe(201);

    // invoice record created
    const inv = insertsOf('invoices')[0].mut.payload;
    expect(inv.contact_id).toBe(CLIENT);
    expect(parseFloat(inv.total)).toBe(1000);

    // balanced, enriched JE
    const je = insertsOf('journal_entries')[0].mut.payload;
    expect(je.company_id).toBe(C1);

    const lines = insertsOf('journal_lines')[0].mut.payload as Row[];
    expect(lines).toHaveLength(2);
    for (const l of lines) expect(l.company_id).toBe(C1);
    const arLine = lines.find((l) => l.account_id === AR);
    const revLine = lines.find((l) => l.account_id === REVENUE);
    expect(arLine.debit).toBe(1000);
    expect(arLine.contact_id).toBe(CLIENT);   // enters the client balance
    expect(arLine.project_id).toBeTruthy();
    expect(revLine.credit).toBe(1000);
    const sum = (k: 'debit' | 'credit') => lines.reduce((s, l) => s + (l[k] || 0), 0);
    expect(sum('debit')).toBe(sum('credit'));
  });

  test('missing revenue account → full rollback (no project, no invoice, no JE)', async () => {
    const db = baseDb();
    db.accounts = db.accounts.filter((a) => a.code !== '4100'); // no revenue
    mockDb = makeDb(db);
    const res = await projectPOST(authedRequest({
      name: 'بدون إيراد', client_id: CLIENT, contract_value: 800, start_date: '2026-01-15',
      auto_invoice: true,
    }));
    expect(res.status).toBe(500);
    expect(deletesOf('projects').length).toBeGreaterThan(0); // rolled back
    expect(insertsOf('invoices')).toHaveLength(0);
    expect(insertsOf('journal_entries')).toHaveLength(0);
  });

  test('foreign client_id → 404 before any write', async () => {
    mockDb = makeDb(baseDb());
    const res = await projectPOST(authedRequest({
      name: 'اختراق', client_id: FOREIGN_CLIENT, contract_value: 300, start_date: '2026-01-15',
    }));
    expect(res.status).toBe(404);
    expect(insertsOf('projects')).toHaveLength(0);
  });
});

describe('projects/costs — single source, no double count, tenant-scoped', () => {
  test('counts each project line once', async () => {
    const db = baseDb();
    db.projects.push({ id: PROJ, company_id: C1, name: 'مشروع' });
    db.journal_lines.push(
      { company_id: C1, project_id: PROJ, account_id: REVENUE, debit: 0, credit: 1000, accounts: { code: '4100', name: 'إيراد', type: 'revenue' } },
      { company_id: C1, project_id: PROJ, account_id: EXPENSE, debit: 600, credit: 0, accounts: { code: '5100', name: 'تكلفة', type: 'expense' } },
    );
    mockDb = makeDb(db);
    const res = await projectCostsGET(withUrl(authedRequest(undefined, 'GET'), `?projectId=${PROJ}`));
    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.data.total_revenue).toBe(1000); // not 2000
    expect(json.data.grand_total).toBe(600);   // not 1200
    expect(json.data.net_profit).toBe(400);
  });

  test('foreign project → 404', async () => {
    const db = baseDb();
    db.projects.push({ id: FOREIGN_PROJ, company_id: C2, name: 'أجنبي' });
    mockDb = makeDb(db);
    const res = await projectCostsGET(withUrl(authedRequest(undefined, 'GET'), `?projectId=${FOREIGN_PROJ}`));
    expect(res.status).toBe(404);
  });
});

describe('projects/[id] DELETE — JE-linked project is protected', () => {
  test('blocked when a journal entry references the project', async () => {
    const db = baseDb();
    db.projects.push({ id: PROJ, company_id: C1, name: 'مشروع' });
    db.journal_entries.push({ id: 'je-1', company_id: C1, project_id: PROJ });
    mockDb = makeDb(db);
    const res = await projectDELETE(authedRequest(undefined, 'DELETE'), paramsOf(PROJ));
    expect(res.status).toBe(400);
    expect((await res.json()).message).toContain('قيود');
    expect(deletesOf('projects')).toHaveLength(0);
  });
});

describe('reports/financial — excludes soft-deleted journal entries', () => {
  test('deleted_at entries are excluded from the trial balance', async () => {
    const db = baseDb();
    db.journal_entries.push(
      { id: 'je-1', company_id: C1, date: '2026-01-01', deleted_at: null },
      { id: 'je-2', company_id: C1, date: '2026-01-02', deleted_at: '2026-01-03' }, // soft-deleted
    );
    db.journal_lines.push(
      { company_id: C1, account_id: AR, journal_entry_id: 'je-1', debit: 500, credit: 0 },
      { company_id: C1, account_id: AR, journal_entry_id: 'je-2', debit: 9999, credit: 0 }, // should be excluded
    );
    mockDb = makeDb(db);
    const res = await financialReportGET(withUrl(authedRequest(undefined, 'GET'), '?type=trial_balance'));
    expect(res.status).toBe(200);
    const json = await res.json();
    // only je-1's 500 counted, not the deleted 9999
    expect(json.data.total_debit).toBe(500);
    // the journal_entries query must filter deleted_at IS NULL
    const jesQuery = mockDb.calls.find((c) => c.table === 'journal_entries' && c.ops.length > 0);
    expect(jesQuery!.ops.some((o) => o.op === 'is' && o.col === 'deleted_at' && o.val === null)).toBe(true);
  });
});
