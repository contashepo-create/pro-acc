## 021-add-daily-worker.sql
Allows `daily_worker` as a `contacts.type` value so the "عمال يومية" (Daily Workers) section is usable.
Run via: `npx tsx src/migrations/run.ts` (idempotent) or apply directly in the DB.

## 022-fix-journal-lines-company-id.sql
`journal_lines.company_id` is `NOT NULL`, but `create_journal_entry` and
`create_invoice_with_journal` omitted it — every atomic journal insert failed
with a not-null violation. This migration rewrites both RPCs to write
`company_id` + `account_name`, and adds a `BEFORE INSERT` trigger that
backfills those columns from `journal_entries` / `accounts` if a leftover
application path still omits them.

Apply in the Supabase SQL editor (or `npx tsx src/migrations/run.ts`) after
deploying the matching app code.

## 023-fix-child-rows-company-id.sql
Same class of bug as 022, on **line/item tables**: `invoice_items`,
`quotation_items`, `purchase_invoice_items`, `purchase_order_items`, etc.
`company_id` is `NOT NULL` but several inserts (including
`create_invoice_with_journal`) omitted it.

This migration rewrites the invoice RPC and adds a `BEFORE INSERT` trigger
that copies `company_id` from the parent document if the app forgot it.

## 024-account-headers-and-cash-link.sql
Adds `accounts.is_header` so group accounts (الأصول، الخصوم، …) cannot be
posted to, re-parents مجمع الإهلاك `1290` under الأصول الثابتة, and creates
a real `banks_safes` cash box (`الخزينة الرئيسية`) linked to account `1110`
for every company that does not already have a safe.

scripts/seed.ts
+8
−8
      [invId, COMPANY_ID, invNo, cid, 30, subtotal, 0.15, vat, total]
    );
    await pool.query(
      `INSERT INTO invoice_items (id, invoice_id, description, quantity, unit_price, total, created_at)
       VALUES ($1,$2,$3,$4,$5,$6,NOW())`,
      [randomUUID(), invId, 'Service', qty, price, subtotal]
      `INSERT INTO invoice_items (id, company_id, invoice_id, description, quantity, unit_price, total, created_at)
       VALUES ($1,$2,$3,$4,$5,$6,$7,NOW())`,
      [randomUUID(), COMPANY_ID, invId, 'Service', qty, price, subtotal]
    );

    const jeId = randomUUID();
    );
    // Balanced: AR = total (dr); Revenue = subtotal (cr); VAT = vat (cr)
    await pool.query(
      `INSERT INTO journal_lines (id, journal_entry_id, account_id, account_code, account_name, debit, credit, created_at)
      `INSERT INTO journal_lines (id, company_id, journal_entry_id, account_id, account_code, account_name, debit, credit, created_at)
       VALUES
        ($1,$2,$3,'1130','Accounts Receivable',$4,0,NOW()),
        ($5,$2,$6,'4100','Contract Revenue',0,$7,NOW()),
        ($8,$2,$9,'2120','VAT Payable',0,$10,NOW())`,
        ($1,$2,$3,$4,'1130','Accounts Receivable',$5,0,NOW()),
        ($6,$2,$3,$7,'4100','Contract Revenue',0,$8,NOW()),
        ($9,$2,$3,$10,'2120','VAT Payable',0,$11,NOW())`,
      [
        randomUUID(), jeId, byCode['1130'], total,
        randomUUID(), COMPANY_ID, jeId, byCode['1130'], total,
        randomUUID(), byCode['4100'], subtotal,
        randomUUID(), byCode['2120'], vat,
      ]

src/__tests__/chart-of-accounts.test.ts
+12
−4
    // auto-account.ts opening balances post against 3100 (capital)
    expect(byCode.get('3100')).toMatchObject({ type: 'equity', parentCode: '3000' });
    // cash / banks / AR / AP / VAT / retained earnings / depreciation
    for (const code of ['1110', '1120', '1130', '2110', '1180', '2120', '3200', '5260', '1290']) {
    for (const code of ['1110', '1120', '1130', '1135', '2110', '1180', '2120', '3200', '5130', '5140', '5260', '1290']) {
      expect(byCode.has(code)).toBe(true);
    }
    expect(byCode.get('1290')!.parentCode).toBe('1200');
    expect(byCode.get('1000')!.isHeader).toBe(true);
    expect(byCode.get('1110')!.isHeader).toBeFalsy();
  });

  test('arabic and english names are non-empty', () => {
    const created = await createDefaultChartOfAccounts(mockDb as any, C1);

    expect(created).toBe(DEFAULT_CHART_OF_ACCOUNTS.length);
    const inserts = mockDb.calls.filter((c) => c.mut.kind === 'insert');
    expect(inserts).toHaveLength(DEFAULT_CHART_OF_ACCOUNTS.length);
    for (const c of inserts) expect(c.mut.payload.company_id).toBe(C1);
    const accountInserts = mockDb.calls.filter((c) => c.mut.kind === 'insert' && c.table === 'accounts');
    expect(accountInserts).toHaveLength(DEFAULT_CHART_OF_ACCOUNTS.length);
    for (const c of accountInserts) expect(c.mut.payload.company_id).toBe(C1);
    const cashSafe = mockDb.calls.find((c) => c.mut.kind === 'insert' && c.table === 'banks_safes');
    expect(cashSafe).toBeDefined();
    expect(cashSafe!.mut.payload.type).toBe('safe');
    expect(cashSafe!.mut.payload.name).toBe('الخزينة الرئيسية');
    const inserts = accountInserts;

    // Parent linking: 1110's update must point at the id that 1100 got
    const insertId = (code: string) =>

src/__tests__/form-utils.test.ts
+49
import { toDateInput, unwrapData, applyDates, recordOrRow } from '@/lib/form-utils';
import * as fs from 'fs';
import * as path from 'path';

process.env.TOKEN_SECRET = 'test-secret-key-for-unit-tests-32chars!';

describe('toDateInput', () => {
  test('keeps YYYY-MM-DD', () => {
    expect(toDateInput('2026-08-01')).toBe('2026-08-01');
  });
  test('strips ISO timestamps so type=date inputs populate', () => {
    expect(toDateInput('2026-08-01T00:00:00.000Z')).toBe('2026-08-01');
    expect(toDateInput('2026-08-01 12:30:00')).toBe('2026-08-01');
  });
  test('empty / null stay empty', () => {
    expect(toDateInput(null)).toBe('');
    expect(toDateInput('')).toBe('');
  });
});

describe('unwrapData', () => {
  test('reads { success, data }', () => {
    expect(unwrapData({ success: true, data: { id: 1 } })).toEqual({ id: 1 });
    expect(unwrapData({ success: false, message: 'x' })).toBeNull();
  });
});

describe('GET /api/journal/[id] does not select a phantom reference column', () => {
  const src = fs.readFileSync(path.join(__dirname, '../app/api/journal/[id]/route.ts'), 'utf8');
  test('select list uses reference_type/reference_id, not reference', () => {
    expect(src).toMatch(/reference_type, reference_id/);
    expect(src).not.toMatch(/description, reference, created_by/);
  });
  test('PUT handler exists for edit save', () => {
    expect(src).toMatch(/export async function PUT/);
  });
});

describe('missing detail routes that made edit forms empty', () => {
  const fs = require('fs') as typeof import('fs');
  const path = require('path') as typeof import('path');
  test('fiscal/[id] and fixed-assets/[id] expose GET+PUT', () => {
    for (const rel of ['../app/api/fiscal/[id]/route.ts', '../app/api/fixed-assets/[id]/route.ts']) {
      const src = fs.readFileSync(path.join(__dirname, rel), 'utf8');
      expect(src).toMatch(/export async function GET/);
      expect(src).toMatch(/export async function PUT/);
    }
  });
});

src/__tests__/invoice-integrity.test.ts
+21
    expect(inv.company_id).toBe(C1);
    expect(inv.status).toBe('unpaid');
    expect(inv.paid_amount).toBe(0);

    const itemInserts = insertsOf('invoice_items');
    expect(itemInserts.length).toBeGreaterThan(0);
    for (const ins of itemInserts) {
      expect(ins.mut.payload.company_id).toBe(C1);
    }
  });

  test('honours per-item discount in server computation', async () => {
    const item = insertsOf('invoice_items')[0].mut.payload;
    expect(item.total).toBe(150);
    expect(item.unit_price).toBe(100);
    expect(item.company_id).toBe(C1);
  });

  test('discount is capped at the item gross', async () => {
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

src/__tests__/journal-integrity.test.ts
+49
// 2. insertJournalLines integrity
// ---------------------------------------------------------------------------

describe('SQL journal RPCs write company_id', () => {
  const fs = require('fs') as typeof import('fs');
  const path = require('path') as typeof import('path');

  test('create_journal_entry / create_invoice_with_journal INSERT lists include company_id', () => {
    const migrationsDir = path.join(__dirname, '../migrations');
    const files = [
      '012-atomic-journal-entry-insert.sql',
      '014-atomic-invoice-creation.sql',
      '022-fix-journal-lines-company-id.sql',
      '023-fix-child-rows-company-id.sql',
    ];
    for (const file of files) {
      const sql = fs.readFileSync(path.join(migrationsDir, file), 'utf8');
      const inserts = [...sql.matchAll(/INSERT INTO journal_lines\s*\(([^)]+)\)/gi)];
      expect(inserts.length).toBeGreaterThan(0);
      for (const m of inserts) {
        expect(m[1]).toMatch(/company_id/i);
      }
    }
  });
});

describe('insertJournalLines', () => {
  test('fails loudly when an account cannot be resolved (no 0000 fallback)', async () => {
    mockDb = makeDb(baseDb());
    const res = await journalPOST(authedRequest(balancedBody));
    expect(res.status).toBe(400);
  });

  test('falls back to legacy insert (with company_id) when live RPC omits company_id', async () => {
    mockDb = makeDb(withTaxAccount(baseDb()));
    mockDb.rpcImpl = async (name: string) => {
      if (name === 'create_journal_entry') {
        return {
          data: null,
          error: {
            code: '23502',
            message: 'null value in column "company_id" of relation "journal_lines" violates not-null constraint',
          },
        };
      }
      return { data: null, error: { message: `Could not find the function ${name}` } };
    };

    const res = await journalPOST(authedRequest(balancedBody));
    expect(res.status).toBe(201);

    const lineInserts = mockDb.calls.filter((c) => c.mut.kind === 'insert' && c.table === 'journal_lines');
    expect(lineInserts.length).toBeGreaterThan(0);
    for (const ins of lineInserts) {
      const rows = Array.isArray(ins.mut.payload) ? ins.mut.payload : [ins.mut.payload];
      for (const r of rows) expect(r.company_id).toBe(C1);
    }
  });
});

// ---------------------------------------------------------------------------

src/__tests__/purchase-integrity.test.ts
+1
    const itemInserts = insertsOf('purchase_order_items');
    expect(itemInserts[0].mut.payload.total).toBe(20);
    expect(itemInserts[1].mut.payload.total).toBe(5);
    for (const ins of itemInserts) expect(ins.mut.payload.company_id).toBe(C1);
  });

  test('negative price rejected', async () => {

src/__tests__/reports-coa-security.test.ts
+55
process.env.TOKEN_SECRET = 'test-secret-key-for-unit-tests-32chars!';

import { HEADER_ACCOUNT_CODES, isHeaderAccount, isCashOrBankCode } from '@/lib/account-resolve';
import { GET as diagnosticsGET } from '@/app/api/diagnostics/route';
import { GET as cleanupGET } from '@/app/api/auth/cleanup-inactive/route';

describe('Chart header / cash-bank helpers', () => {
  test('group accounts are headers and cash/bank codes are recognized', () => {
    expect(HEADER_ACCOUNT_CODES.has('1000')).toBe(true);
    expect(HEADER_ACCOUNT_CODES.has('1110')).toBe(false);
    expect(isHeaderAccount({ code: '1000' })).toBe(true);
    expect(isHeaderAccount({ code: '1110', is_header: false })).toBe(false);
    expect(isHeaderAccount({ code: '1110', children: [{ id: 1 }] })).toBe(true);
    expect(isCashOrBankCode('1110')).toBe(true);
    expect(isCashOrBankCode('1110-0001')).toBe(true);
    expect(isCashOrBankCode('1130')).toBe(false);
  });
});

describe('Diagnostics is no longer public', () => {
  test('anonymous GET is 401', async () => {
    const res = await diagnosticsGET({
      headers: { get: () => null },
      cookies: { get: () => undefined },
    } as any);
    expect(res.status).toBe(401);
  });
});

describe('cleanup-inactive refuses an unset secret', () => {
  const prev = process.env.CRON_SECRET;

  afterEach(() => {
    if (prev === undefined) delete process.env.CRON_SECRET;
    else process.env.CRON_SECRET = prev;
  });

  test('missing CRON_SECRET → 401 even with a header', async () => {
    delete process.env.CRON_SECRET;
    const res = await cleanupGET({
      headers: { get: (k: string) => (k === 'x-cron-secret' ? 'anything' : null) },
    } as any);
    expect(res.status).toBe(401);
    const json = await res.json();
    expect(json.message).toMatch(/CRON_SECRET|غير مصرح/);
  });

  test('wrong secret → 401', async () => {
    process.env.CRON_SECRET = 'expected-secret-value-32chars!!!!';
    const res = await cleanupGET({
      headers: { get: (k: string) => (k === 'x-cron-secret' ? 'wrong-secret-value-32chars!!!!!!' : null) },
    } as any);
    expect(res.status).toBe(401);
  });
});

src/app/(dashboard)/accounts/page.tsx
+1
        <span style={{ paddingRight: `${(row.depth || 0) * 20}px` }} className="flex items-center gap-2">
          {row.depth > 0 && <FolderTree size={14} className="text-text-muted" />}
          {row.name}
          {row.is_header && <Badge variant="info">رئيسي</Badge>}
        </span>
      ),
    },

src/app/(dashboard)/cash/page.tsx
+36
−26
import { ActionButtons } from '@/components/ui/ActionButtons';
import { toast } from '@/components/ui/Toast';
import { formatDate, formatCurrency } from '@/lib/utils';
import { fetchRecord, applyDates, recordOrRow } from '@/lib/form-utils';

export default function CashPage() {
  const [transactions, setTransactions] = useState<any[]>([]);
        conRes.json(),
      ]);
      if (txJson.success) {
        setTransactions(txJson.data?.rows || []);
        setTransactions(txJson.data?.transactions || txJson.data?.rows || []);
      } else {
        setError(txJson.message || 'فشل');
        toast.error(txJson.message || 'فشل تحميل البيانات');
      }
      if (bankJson.success) setBanks(bankJson.data?.banks || []);
      if (accJson.success) setAccounts(accJson.data?.accounts || []);
      if (accJson.success) {
        const flatten = (nodes: any[], out: any[] = []): any[] => {
          for (const n of nodes || []) {
            if (!n.is_header) out.push(n);
            if (n.children?.length) flatten(n.children, out);
          }
          return out;
        };
        setAccounts(flatten(accJson.data?.accounts || []));
      }
      if (conJson.success) setContacts(conJson.data?.contacts || []);
    } catch (err) {
      setError('فشل تحميل البيانات');
      const res = await fetch(url, {
        method,
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(form),
        body: JSON.stringify({
          ...form,
          type: form.type === 'receipt' || form.type === 'revenue' ? 'revenue' : 'expense',
          accountId: form.account_id,
          bankSafeId: form.bank_safe_id,
          contactId: form.contact_id,
        }),
      });
      const json = await res.json();
      if (json.success) {
  };

  const handleEdit = async (transaction: any) => {
    try {
      const res = await fetch(`/api/cash/${transaction.id}`);
      const json = await res.json();
      if (json.success) {
        setEditingTransaction(transaction);
        setForm({
          date: json.data.date,
          type: json.data.type,
          amount: json.data.amount,
          account_id: json.data.account_id,
          bank_safe_id: json.data.bank_safe_id || '',
          contact_id: json.data.contact_id || '',
          reason: json.data.reason || '',
        });
        setShowModal(true);
      } else {
        toast.error(json.message || 'فشل تحميل البيانات');
      }
    } catch (e) {
      toast.error('خطأ في الاتصال بالخادم');
    }
    const { data, error } = await fetchRecord(`/api/cash/${transaction.id}`);
    const src = recordOrRow(data, transaction);
    if (!data && error) toast.error(error);
    setEditingTransaction(transaction);
    setForm(applyDates({
      date: src.date,
      type: src.type || 'receipt',
      amount: src.amount || 0,
      account_id: src.account_id || '',
      bank_safe_id: src.bank_safe_id || '',
      contact_id: src.contact_id || '',
      reason: src.reason || '',
    }, ['date']));
    setShowModal(true);
  };

  const handleDelete = async (transaction: any) => {
  const typeBadge = (type: string) => {
    const map: Record<string, { variant: 'success' | 'danger'; label: string }> = {
      receipt: { variant: 'success', label: 'قبض' },
      revenue: { variant: 'success', label: 'قبض' },
      expense: { variant: 'danger', label: 'صرف' },
    };
    const m = map[type] || { variant: 'success', label: type };
  return (
    <div className="space-y-6">
      <PageHeader
        title="النقدية"
        description="إدارة المعاملات النقدية"
        title="حركة النقدية"
        description="قبض وصرف يومي مرتبط بالخزائن والبنوك المسجّلة في دليل الحسابات"
        actions={
          <Button onClick={() => { setEditingTransaction(null); setShowModal(true); }} leftIcon={<Plus size={18} />}>
            إضافة معاملة

src/app/(dashboard)/clients/page.tsx
+1
−1
          iban: d.iban || '', bank_name: d.bank_name || '', swift_code: d.swift_code || '',
          opening_balance: d.opening_balance || 0, opening_balance_type: d.opening_balance_type || 'debit',
          payment_terms: d.payment_terms || 'immediate', notes: d.notes || '',
          date_of_birth: d.date_of_birth || '', gender: d.gender || '', national_id: d.national_id || '', category: d.category || '',
          date_of_birth: (d.date_of_birth || '').toString().slice(0, 10), gender: d.gender || '', national_id: d.national_id || '', category: d.category || '',
        });
        setShowModal(true);
      }

src/app/(dashboard)/custodies/page.tsx
+2
import { LoadingSkeleton } from '@/components/ui/LoadingSkeleton';
import { ActionButtons } from '@/components/ui/ActionButtons';
import { formatDate, formatCurrency } from '@/lib/utils';
import { fetchRecord, applyDates, recordOrRow } from '@/lib/form-utils';
import { toast } from '@/components/ui/Toast';

export default function CustodiesPage() {
  const [custodies, setCustodies] = useState<any[]>([]);

src/app/(dashboard)/employee-advances/page.tsx
+13
−16
import { LoadingSkeleton } from '@/components/ui/LoadingSkeleton';
import { ActionButtons } from '@/components/ui/ActionButtons';
import { formatDate, formatCurrency } from '@/lib/utils';
import { fetchRecord, applyDates, recordOrRow } from '@/lib/form-utils';
import { toast } from '@/components/ui/Toast';

export default function EmployeeAdvancesPage() {
  const [advances, setAdvances] = useState<any[]>([]);
  };

  const handleEdit = async (advance: any) => {
    try {
      const res = await fetch(`/api/employee-advances/${advance.id}`);
      const json = await res.json();
      if (json.success) {
        setEditingAdvance(advance);
        setForm({
          employee_id: json.data.employee_id,
          amount: json.data.amount,
          date: json.data.date,
          reason: json.data.reason || '',
        });
        setShowModal(true);
      }
    } catch (e) {
      console.error('Failed to load advance:', e);
    }
    const { data, error } = await fetchRecord(`/api/employee-advances/${advance.id}`);
    const src = recordOrRow(data, advance);
    if (!data && error) toast.error(error);
    setEditingAdvance(advance);
    setForm(applyDates({
      employee_id: src.employee_id || '',
      amount: src.amount || 0,
      date: src.date,
      reason: src.reason || '',
    }, ['date']));
    setShowModal(true);
  };

  const handleDelete = async (advance: any) => {

src/app/(dashboard)/employees/page.tsx
+15
−21
import { ActionButtons } from '@/components/ui/ActionButtons';
import { toast } from '@/components/ui/Toast';
import { formatDate, formatCurrency } from '@/lib/utils';
import { fetchRecord, applyDates, recordOrRow } from '@/lib/form-utils';

export default function EmployeesPage() {
  const [employees, setEmployees] = useState<any[]>([]);
  };

  const handleEdit = async (employee: any) => {
    try {
      const res = await fetch(`/api/employees/${employee.id}`);
      const json = await res.json();
      if (json.success) {
        setEditingEmployee(employee);
        setForm({
          name: json.data.name,
          phone: json.data.phone || '',
          email: json.data.email || '',
          salary: json.data.salary,
          department: json.data.department || '',
          position: json.data.position || '',
          hire_date: json.data.hire_date,
        });
        setShowModal(true);
      } else {
        toast.error(json.message || 'فشل تحميل البيانات');
      }
    } catch (e) {
      toast.error('خطأ في الاتصال بالخادم');
    }
    const { data, error } = await fetchRecord(`/api/employees/${employee.id}`);
    const src = recordOrRow(data, employee);
    if (!data && error) toast.error(error);
    setEditingEmployee(employee);
    setForm(applyDates({
      name: src.name || '',
      phone: src.phone || '',
      email: src.email || '',
      salary: src.salary || 0,
      department: src.department || '',
      position: src.position || '',
      hire_date: src.hire_date,
    }, ['hire_date']));
    setShowModal(true);
  };

  const handleDelete = async (employee: any) => {

src/app/(dashboard)/fiscal/page.tsx
+12
−11
import { LoadingSkeleton } from '@/components/ui/LoadingSkeleton';
import { ActionButtons } from '@/components/ui/ActionButtons';
import { formatDate } from '@/lib/utils';
import { fetchRecord, applyDates, recordOrRow } from '@/lib/form-utils';
import { toast } from '@/components/ui/Toast';

export default function FiscalPage() {
  const [fiscalYears, setFiscalYears] = useState<any[]>([]);
  };

  const handleEdit = async (year: any) => {
    try {
      const res = await fetch(`/api/fiscal/${year.id}`);
      const json = await res.json();
      if (json.success) {
        setEditingYear(year);
        setForm({ name: json.data.name, start_date: json.data.start_date, end_date: json.data.end_date });
        setShowModal(true);
      }
    } catch (e) {
      console.error('Failed to load fiscal year:', e);
    }
    const { data, error } = await fetchRecord(`/api/fiscal/${year.id}`);
    const src = recordOrRow(data, year);
    if (!data && error) toast.error(error);
    setEditingYear(year);
    setForm(applyDates({
      name: src.name || '',
      start_date: src.start_date || '',
      end_date: src.end_date || '',
    }, ['start_date', 'end_date']));
    setShowModal(true);
  };

  const handleDelete = async (year: any) => {

src/app/(dashboard)/fixed-assets/page.tsx
+19
−22
import { LoadingSkeleton } from '@/components/ui/LoadingSkeleton';
import { ActionButtons } from '@/components/ui/ActionButtons';
import { formatDate, formatCurrency } from '@/lib/utils';
import { fetchRecord, applyDates, recordOrRow } from '@/lib/form-utils';
import { toast } from '@/components/ui/Toast';

export default function FixedAssetsPage() {
  const [assets, setAssets] = useState<any[]>([]);
  };

  const handleEdit = async (asset: any) => {
    try {
      const res = await fetch(`/api/fixed-assets/${asset.id}`);
      const json = await res.json();
      if (json.success) {
        setEditingAsset(asset);
        setForm({
          name: json.data.name,
          code: json.data.code,
          category: json.data.category || '',
          purchase_date: json.data.purchase_date,
          purchase_cost: json.data.purchase_cost,
          useful_life_years: json.data.useful_life_years,
          depreciation_rate: json.data.depreciation_rate,
          depreciation_method: json.data.depreciation_method,
          location: json.data.location || '',
          notes: json.data.notes || '',
        });
        setShowModal(true);
      }
    } catch (e) {
      console.error('Failed to load asset:', e);
    }
    const { data, error } = await fetchRecord(`/api/fixed-assets/${asset.id}`);
    const src = recordOrRow(data, asset);
    if (!data && error) toast.error(error);
    setEditingAsset(asset);
    setForm(applyDates({
      name: src.name || '',
      code: src.code || '',
      category: src.category || '',
      purchase_date: src.purchase_date,
      purchase_cost: src.purchase_cost || 0,
      useful_life_years: src.useful_life_years || 5,
      depreciation_rate: src.depreciation_rate || 20,
      depreciation_method: src.depreciation_method || 'straight_line',
      location: src.location || '',
      notes: src.notes || '',
    }, ['purchase_date']));
    setShowModal(true);
  };

  const handleDelete = async (asset: any) => {

src/app/(dashboard)/inventory-transactions/page.tsx
+2
import { LoadingSkeleton } from '@/components/ui/LoadingSkeleton';
import { ActionButtons } from '@/components/ui/ActionButtons';
import { formatDate, formatCurrency } from '@/lib/utils';
import { fetchRecord, applyDates, recordOrRow } from '@/lib/form-utils';
import { toast } from '@/components/ui/Toast';

export default function InventoryTransactionsPage() {
  const [transactions, setTransactions] = useState<any[]>([]);

src/app/(dashboard)/invoices/page.tsx
+13
−12
'use client';

import { useState, useEffect } from 'react';
import { Plus, Trash2, ArrowRight, FileText, Save, X, Search, Eye } from 'lucide-react';
import { Plus, Trash2, ArrowRight, FileText, Save, X } from 'lucide-react';
import { PageHeader } from '@/components/ui/PageHeader';
import { DataTable } from '@/components/ui/DataTable';
import { Button } from '@/components/ui/Button';
import { ActionButtons } from '@/components/ui/ActionButtons';
import { toast } from '@/components/ui/Toast';
import { formatDate, formatCurrency } from '@/lib/utils';
import { toDateInput } from '@/lib/form-utils';

interface InvoiceItem {
  id?: string;
      if (json.success) {
        setEditingInvoice(invoice);
        setForm({
          client_id: json.data.contact_id,
          client_id: json.data.contact_id || json.data.client_id || '',
          project_id: json.data.project_id || '',
          date: json.data.date,
          due_date: json.data.due_date || '',
          date: toDateInput(json.data.date),
          due_date: toDateInput(json.data.due_date),
          notes: json.data.notes || '',
          vat_enabled: (json.data.vat_rate || json.data.tax_rate || 0) > 0,
          vat_enabled: Number(json.data.vat_rate || json.data.tax_rate || 0) > 0,
          items: json.data.items?.map((i: any) => ({
            id: i.id,
            description: i.description,
  const columns = [
    { key: 'number', label: 'رقم الفاتورة', sortable: true, render: (row: any) => `#${row.number}` },
    { key: 'date', label: 'التاريخ', sortable: true, render: (row: any) => formatDate(row.date) },
    { key: 'contact_name', label: 'العميل', sortable: true },
    { key: 'contact_name', label: 'العميل', sortable: true, render: (row: any) => row.contact_name || row.client_name || '—' },
    { key: 'total', label: 'الإجمالي', sortable: true, render: (row: any) => formatCurrency(row.total) },
    { key: 'status', label: 'الحالة', sortable: true, render: (row: any) => statusBadge(row.status) },
    { key: 'paid_amount', label: 'المدفوع', render: (row: any) => formatCurrency(row.paid_amount) },
    { key: 'actions', label: '', render: (row: any) => (
      <div className="flex items-center gap-1">
        <a href={`/invoices/${row.id}/view`} target="_blank" rel="noopener noreferrer">
          <Button variant="ghost" size="sm" title="عرض/طباعة">
            <Eye size={16} />
          </Button>
        </a>
        <ActionButtons item={row} onEdit={handleEdit} onDelete={handleDelete} />
        <ActionButtons
          item={row}
          onView={() => { window.location.href = `/invoices/${row.id}/view`; }}
          onEdit={handleEdit}
          onDelete={handleDelete}
        />
      </div>
    )},
  ];

src/app/(dashboard)/journal/new/page.tsx
+16
−12
import { Select } from '@/components/ui/Select';
import { Textarea } from '@/components/ui/Textarea';
import { toast } from '@/components/ui/Toast';
import { toDateInput } from '@/lib/form-utils';

interface JournalLine { accountCode: string; debit: number; credit: number; description: string; }

function flatten(accounts: any[], depth = 0, out: any[] = []): any[] {
  for (const a of accounts || []) {
    const isParent = Boolean(a.children && a.children.length > 0);
    const isParent = Boolean(a.is_header) || Boolean(a.children && a.children.length > 0);
    out.push({
      code: a.code,
      name: a.name,
      .then((j) => { if (j.success) setAccounts(flatten(j.data?.accounts || [])); });

    if (p) {
      fetch(`/api/journal/${p}`)
      fetch(`/api/journal/${p}`, { credentials: 'same-origin' })
        .then((r) => r.json())
        .then((j) => {
          if (j.success) {
          if (j.success && j.data) {
            const d = j.data;
            setForm({
              date: d.date,
              type: d.type,
              description: d.description,
              date: toDateInput(d.date),
              type: d.type || 'general',
              description: d.description || '',
              lines:
                d.lines?.map((l: any) => ({
                  accountCode: l.account_code,
                  debit: l.debit,
                  credit: l.credit,
                (d.lines || []).map((l: any) => ({
                  accountCode: l.account_code || l.accountCode || '',
                  debit: Number(l.debit) || 0,
                  credit: Number(l.credit) || 0,
                  description: l.description || '',
                })) || [{ accountCode: '', debit: 0, credit: 0, description: '' }],
                })),
            });
          } else {
            toast.error(j.message || 'تعذر تحميل القيد للتعديل');
          }
        });
        })
        .catch(() => toast.error('تعذر تحميل القيد للتعديل'));
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

src/app/(dashboard)/journal/page.tsx
+38
import { LoadingSkeleton } from '@/components/ui/LoadingSkeleton';
import { EmptyState } from '@/components/ui/EmptyState';
import { ActionButtons } from '@/components/ui/ActionButtons';
import { RecordViewModal } from '@/components/ui/RecordViewModal';
import { toast } from '@/components/ui/Toast';
import { formatDate, formatCurrency } from '@/lib/utils';

  const [entries, setEntries] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [viewing, setViewing] = useState<any>(null);

  const fetchData = async () => {
    try {
      render: (r: any) => (
        <ActionButtons
          item={r}
          onView={async () => {
            try {
              const res = await fetch(`/api/journal/${r.id}`, { credentials: 'same-origin' });
              const json = await res.json();
              if (json.success) setViewing(json.data);
              else toast.error(json.message || 'تعذر عرض القيد');
            } catch { toast.error('تعذر عرض القيد'); }
          }}
          onEdit={() => router.push(`/journal/new?edit=${r.id}`)}
          onDelete={() => handleDelete(r)}
        />
      ) : (
        <DataTable columns={columns} data={entries} searchable searchKeys={['number', 'description']} />
      )}
      <RecordViewModal
        isOpen={!!viewing}
        onClose={() => setViewing(null)}
        title={viewing ? `قيد رقم ${viewing.number}` : 'عرض القيد'}
        record={viewing}
        extra={viewing?.lines?.length ? (
          <div className="border border-border rounded-lg overflow-hidden">
            <table className="w-full text-sm">
              <thead className="bg-bg-secondary text-text-muted">
                <tr>
                  <th className="p-2 text-right">الحساب</th>
                  <th className="p-2 text-right">مدين</th>
                  <th className="p-2 text-right">دائن</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-border">
                {viewing.lines.map((l: any) => (
                  <tr key={l.id}>
                    <td className="p-2">{l.account_code} — {l.account_name || ''}</td>
                    <td className="p-2 font-mono">{formatCurrency(l.debit || 0)}</td>
                    <td className="p-2 font-mono">{formatCurrency(l.credit || 0)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : null}
      />
    </div>
  );
}

src/app/(dashboard)/payroll/page.tsx
+71
−36
'use client';

import { useState, useEffect } from 'react';
import { Play, Eye } from 'lucide-react';
import { Play } from 'lucide-react';
import { PageHeader } from '@/components/ui/PageHeader';
import { DataTable } from '@/components/ui/DataTable';
import { Button } from '@/components/ui/Button';
import { Modal } from '@/components/ui/Modal';
import { Input } from '@/components/ui/Input';
import { Select } from '@/components/ui/Select';
import { Badge } from '@/components/ui/Badge';
import { EmptyState } from '@/components/ui/EmptyState';
import { LoadingSkeleton } from '@/components/ui/LoadingSkeleton';
import { ActionButtons } from '@/components/ui/ActionButtons';
import { toast } from '@/components/ui/Toast';
import { formatDate, formatCurrency } from '@/lib/utils';

export default function PayrollPage() {
  const [records, setRecords] = useState<any[]>([]);
  const [employees, setEmployees] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [showProcess, setShowProcess] = useState(false);
  const [month, setMonth] = useState(new Date().toISOString().slice(0, 7));
  const [processing, setProcessing] = useState(false);

  useEffect(() => {
    const fetchData = async () => {
      try {
        setLoading(true);
        const res = await fetch('/api/payroll');
        const json = await res.json();
        if (json.success) {
          setRecords(json.data?.records || []);
        } else {
          setError(json.message || 'فشل تحميل البيانات');
        }
      } catch {
        setError('فشل تحميل البيانات');
      } finally {
        setLoading(false);
  const fetchData = async () => {
    try {
      setLoading(true);
      const [payRes, empRes] = await Promise.all([
        fetch('/api/payroll', { credentials: 'same-origin' }),
        fetch('/api/employees', { credentials: 'same-origin' }),
      ]);
      const [payJson, empJson] = await Promise.all([payRes.json(), empRes.json()]);
      if (payJson.success) setRecords(payJson.data?.records || []);
      else setError(payJson.message || 'فشل تحميل البيانات');
      if (empJson.success) setEmployees(empJson.data?.employees || []);
    } catch {
      setError('فشل تحميل البيانات');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { fetchData(); }, []);

  const handleProcess = async () => {
    if (!month) { toast.error('اختر الشهر'); return; }
    if (employees.length === 0) { toast.error('لا يوجد موظفون للمعالجة'); return; }
    setProcessing(true);
    try {
      const date = `${month}-01`;
      const res = await fetch('/api/payroll', {
        method: 'POST',
        credentials: 'same-origin',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ date, employee_ids: employees.map((e) => e.id) }),
      });
      const json = await res.json();
      if (json.success) {
        toast.success(`تم معالجة ${json.data?.length || 0} راتب`);
        setShowProcess(false);
        fetchData();
      } else {
        toast.error(json.message || 'فشل معالجة الرواتب');
      }
    };
    fetchData();
  }, []);
    } catch {
      toast.error('خطأ في الاتصال');
    } finally {
      setProcessing(false);
    }
  };

  const columns = [
    { key: 'date', label: 'الشهر', sortable: true, render: (row: any) => row.date?.substring(0, 7) },
    { key: 'basic_salary', label: 'الراتب الأساسي', sortable: true, render: (row: any) => formatCurrency(row.basic_salary) },
    { key: 'advance_deduction', label: 'خصم السلف', sortable: true, render: (row: any) => formatCurrency(row.advance_deduction) },
    { key: 'net_pay', label: 'صافي الراتب', sortable: true, render: (row: any) => formatCurrency(row.net_pay) },
    {
      key: 'actions',
      label: 'إجراءات',
      render: (row: any) => <ActionButtons item={{ ...row, date: formatDate(row.date) }} />,
    },
  ];

  if (loading) return <LoadingSkeleton variant="table" count={8} />;

  if (error) {
    return (
      <div className="space-y-6">
        <PageHeader title="الرواتب" description="إدارة ومعالجة الرواتب"
          actions={<Button onClick={() => setShowProcess(true)} leftIcon={<Play size={18} />}>معالجة الرواتب</Button>}
        />
        <div className="bg-danger/10 border border-danger/30 rounded-lg p-4 text-danger">{error}</div>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <PageHeader title="الرواتب" description="إدارة ومعالجة الرواتب"
        actions={<Button onClick={() => setShowProcess(true)} leftIcon={<Play size={18} />}>معالجة الرواتب</Button>}
      />
      {error && <div className="bg-danger/10 border border-danger/30 rounded-lg p-4 text-danger">{error}</div>}
      {records.length === 0 ? (
        <EmptyState title="لا توجد معالجات سابقة" description="قم بمعالجة الرواتب لشهر جديد" actionLabel="معالجة الرواتب" onAction={() => setShowProcess(true)} />
      ) : (
        <DataTable columns={columns} data={records} searchable searchKeys={['employee_name']} />
      )}
      <Modal isOpen={showProcess} onClose={() => setShowProcess(false)} title="معالجة الرواتب" size="lg" footer={<div className="flex items-center gap-2"><Button variant="ghost" onClick={() => setShowProcess(false)}>إلغاء</Button><Button>معالجة</Button></div>}>
      <Modal
        isOpen={showProcess}
        onClose={() => setShowProcess(false)}
        title="معالجة الرواتب"
        size="lg"
        footer={
          <div className="flex items-center gap-2">
            <Button variant="ghost" onClick={() => setShowProcess(false)}>إلغاء</Button>
            <Button onClick={handleProcess} disabled={processing}>{processing ? 'جاري المعالجة...' : 'معالجة'}</Button>
          </div>
        }
      >
        <div className="space-y-4">
          <Input label="الشهر" type="month" />
          <Select label="الموظفين" options={[{ value: 'all', label: 'جميع الموظفين' }]} />
          <p className="text-sm text-text-muted">سيتم إنشاء قيد محاسبي (Dr مصروفات رواتب / Cr رواتب مستحقة + Cr سلف موظفين)</p>
          <Input label="الشهر" type="month" value={month} onChange={(e) => setMonth(e.target.value)} />
          <p className="text-sm text-text-muted">سيتم معالجة رواتب {employees.length} موظف وإنشاء قيد محاسبي متزن (مدين مصروف رواتب / دائن رواتب مستحقة + سلف).</p>
        </div>
      </Modal>
    </div>

src/app/(dashboard)/progress-billing/page.tsx
+18
−19
import { LoadingSkeleton } from '@/components/ui/LoadingSkeleton';
import { ActionButtons } from '@/components/ui/ActionButtons';
import { formatDate, formatCurrency } from '@/lib/utils';
import { fetchRecord, applyDates, recordOrRow } from '@/lib/form-utils';
import { toast } from '@/components/ui/Toast';

export default function ProgressBillingPage() {
  const [claims, setClaims] = useState<any[]>([]);
      ]);
      if (claimJson.success) setClaims(claimJson.data?.claims || []);
      else setError(claimJson.message || 'فشل');
      if (projJson.success) setProjects(projJson.data?.projects || []);
      if (projJson.success) setProjects(projJson.data?.rows || projJson.data?.projects || []);
    } catch { setError('فشل تحميل البيانات'); } finally { setLoading(false); }
  };

  };

  const handleEdit = async (claim: any) => {
    try {
      const res = await fetch(`/api/progress-billing/${claim.id}`);
      const json = await res.json();
      if (json.success) {
        setEditingClaim(claim);
        setForm({
          project_id: json.data.project_id,
          date: json.data.date,
          gross_amount: json.data.gross_amount,
          retention_percentage: json.data.retention_percentage,
          notes: json.data.notes || '',
          is_final: json.data.is_final || false,
        });
        setShowModal(true);
      }
    } catch (e) {
      console.error('Failed to load claim:', e);
    }
    const { data, error } = await fetchRecord(`/api/progress-billing/${claim.id}`);
    const src = recordOrRow(data, claim);
    if (!data && error) toast.error(error);
    setEditingClaim(claim);
    setForm(applyDates({
      project_id: src.project_id || '',
      date: src.date,
      gross_amount: src.gross_amount || 0,
      retention_percentage: src.retention_percentage ?? src.retention_rate ?? 10,
      notes: src.notes || src.description || '',
      is_final: src.is_final || false,
      tax_enabled: Number(src.tax_rate || 0) > 0,
      tax_rate: src.tax_rate || 0.15,
    }, ['date']));
    setShowModal(true);
  };

  const handleDelete = async (claim: any) => {

src/app/(dashboard)/projects/page.tsx
+14
−8
import { ActionButtons } from '@/components/ui/ActionButtons';
import { toast } from '@/components/ui/Toast';
import { formatDate, formatCurrency } from '@/lib/utils';
import { toDateInput } from '@/lib/form-utils';
import { useSidebarStore } from '@/store/sidebar-store';
import { useAuthStore } from '@/store/auth-store';

      const json = await res.json();
      if (json.success) {
        setEditingProject(project);
        const d = json.data;
        setForm({
          name: json.data.name,
          client_id: json.data.client_id || '',
          start_date: json.data.start_date,
          end_date: json.data.end_date || '',
          contract_value: json.data.contract_value || 0,
          description: json.data.description || '',
          location: json.data.location || '',
          name: d.name || '',
          client_id: d.client_id || d.contact_id || '',
          start_date: toDateInput(d.start_date),
          end_date: toDateInput(d.end_date),
          contract_value: d.contract_value || 0,
          description: d.description || '',
          location: d.location || '',
          auto_invoice: false,
        });
        setBoqItems(json.data.boq_items || []);
        setBoqItems((d.boq_items || []).length
          ? d.boq_items
          : [{ description: '', unit: 'متر', quantity: 1, unit_price: 0, total: 0 }]);
        setShowModal(true);
      } else {
        toast.error(json.message || 'تعذر تحميل المشروع');
      }
    } catch (e) {
      console.error('Failed to load project:', e);

src/app/(dashboard)/purchases/invoices/page.tsx
+16
−19
import { LoadingSkeleton } from '@/components/ui/LoadingSkeleton';
import { ActionButtons } from '@/components/ui/ActionButtons';
import { formatDate, formatCurrency } from '@/lib/utils';
import { fetchRecord, applyDates, recordOrRow } from '@/lib/form-utils';
import { toast } from '@/components/ui/Toast';

interface PurchaseItem {
  description: string;
  };

  const handleEdit = async (invoice: any) => {
    try {
      const res = await fetch(`/api/purchases/invoices/${invoice.id}`);
      const json = await res.json();
      if (json.success) {
        setEditingInvoice(invoice);
        setForm({
          date: json.data.date,
          supplier_id: json.data.supplier_id,
          purchase_order_id: json.data.purchase_order_id || '',
          notes: json.data.notes || '',
          tax_percent: Math.round((Number(json.data.tax_rate) || 0) * 100),
          status: json.data.status || 'unpaid',
          items: json.data.items?.length ? json.data.items : [{ ...emptyItem }],
        });
        setShowModal(true);
      }
    } catch (e) {
      console.error('Failed to load invoice:', e);
    }
    const { data, error } = await fetchRecord(`/api/purchases/invoices/${invoice.id}`);
    const src = recordOrRow(data, invoice);
    if (!data && error) toast.error(error);
    setEditingInvoice(invoice);
    setForm(applyDates({
      date: src.date,
      supplier_id: src.supplier_id || '',
      purchase_order_id: src.purchase_order_id || '',
      notes: src.notes || '',
      tax_percent: Math.round((Number(src.tax_rate) || 0) * 100),
      status: src.status || 'unpaid',
      items: src.items?.length ? src.items : [{ ...emptyItem }],
    }, ['date']));
    setShowModal(true);
  };

  const handleDelete = async (invoice: any) => {

src/app/(dashboard)/purchases/orders/page.tsx
+13
−16
import { LoadingSkeleton } from '@/components/ui/LoadingSkeleton';
import { ActionButtons } from '@/components/ui/ActionButtons';
import { formatDate, formatCurrency } from '@/lib/utils';
import { fetchRecord, applyDates, recordOrRow } from '@/lib/form-utils';
import { toast } from '@/components/ui/Toast';

interface OrderItem {
  description: string;
  };

  const handleEdit = async (order: any) => {
    try {
      const res = await fetch(`/api/purchases/orders/${order.id}`);
      const json = await res.json();
      if (json.success) {
        setEditingOrder(order);
        setForm({
          date: json.data.date,
          supplier_id: json.data.supplier_id,
          notes: json.data.notes || '',
          items: json.data.items?.length ? json.data.items : [{ ...emptyItem }],
        });
        setShowModal(true);
      }
    } catch (e) {
      console.error('Failed to load order:', e);
    }
    const { data, error } = await fetchRecord(`/api/purchases/orders/${order.id}`);
    const src = recordOrRow(data, order);
    if (!data && error) toast.error(error);
    setEditingOrder(order);
    setForm(applyDates({
      date: src.date,
      supplier_id: src.supplier_id || '',
      notes: src.notes || '',
      items: src.items?.length ? src.items : [{ ...emptyItem }],
    }, ['date']));
    setShowModal(true);
  };

  const handleReceive = async (order: any) => {

src/app/(dashboard)/quotations/page.tsx
+36
−6
import { ActionButtons } from '@/components/ui/ActionButtons';
import { toast } from '@/components/ui/Toast';
import { formatDate, formatCurrency } from '@/lib/utils';
import { toDateInput } from '@/lib/form-utils';

export default function QuotationsPage() {
  const [quotations, setQuotations] = useState<any[]>([]);
      const json = await res.json();
      if (json.success) {
        setEditingQuotation(quotation);
        const d = json.data;
        setForm({
          date: json.data.date,
          contact_id: json.data.contact_id,
          valid_until: json.data.valid_until || '',
          notes: json.data.notes || '',
          items: json.data.items || [{ description: '', quantity: 1, unit_price: 0, total: 0 }],
          date: toDateInput(d.date),
          contact_id: d.contact_id || '',
          valid_until: toDateInput(d.valid_until),
          notes: d.notes || '',
          tax_rate: d.tax_rate ?? 0.15,
          tax_enabled: Number(d.tax_rate || 0) > 0,
          items: (d.items || []).length
            ? d.items
            : [{ description: '', quantity: 1, unit_price: 0, total: 0 }],
        });
        setShowModal(true);
      } else {
        toast.error(json.message || 'تعذر تحميل عرض السعر');
      }
    } catch (e) {
      console.error('Failed to load quotation:', e);
      toast.error('تعذر تحميل عرض السعر');
    }
  };

          </div>
          <Textarea label="ملاحظات" value={form.notes} onChange={(e) => setForm({...form, notes: e.target.value})} placeholder="ملاحظات عرض السعر" />
          <Checkbox label="تطبيق ضريبة القيمة المضافة (15%)" checked={form.tax_enabled} onChange={(checked: boolean) => setForm({...form, tax_enabled: checked, tax_rate: checked ? 0.15 : 0})} />
          <div className="space-y-2">
            <div className="flex items-center justify-between">
              <h4 className="text-sm font-bold">بنود العرض</h4>
              <Button type="button" size="sm" variant="ghost" onClick={() => setForm({ ...form, items: [...form.items, { description: '', quantity: 1, unit_price: 0, total: 0 }] })}>إضافة بند</Button>
            </div>
            {form.items.map((item: any, idx: number) => (
              <div key={idx} className="grid grid-cols-12 gap-2">
                <input className="input-base col-span-5 text-sm" placeholder="البيان" value={item.description} onChange={(e) => {
                  const items = [...form.items]; items[idx] = { ...items[idx], description: e.target.value }; setForm({ ...form, items });
                }} />
                <input className="input-base col-span-2 text-sm" type="number" placeholder="الكمية" value={item.quantity} onChange={(e) => {
                  const q = parseFloat(e.target.value) || 0; const items = [...form.items];
                  items[idx] = { ...items[idx], quantity: q, total: q * (Number(items[idx].unit_price) || 0) }; setForm({ ...form, items });
                }} />
                <input className="input-base col-span-3 text-sm" type="number" placeholder="سعر الوحدة" value={item.unit_price} onChange={(e) => {
                  const p = parseFloat(e.target.value) || 0; const items = [...form.items];
                  items[idx] = { ...items[idx], unit_price: p, total: p * (Number(items[idx].quantity) || 0) }; setForm({ ...form, items });
                }} />
                <div className="col-span-2 text-sm font-mono flex items-center">{formatCurrency(item.total || 0)}</div>
              </div>
            ))}
          </div>
          {saveError && <div className="bg-danger/10 border border-danger/20 text-danger text-sm rounded-lg p-3">{saveError}</div>}
        </div>
      </Modal>

src/app/(dashboard)/reports/page.tsx
+356
−77
'use client';

import { useState, useEffect } from 'react';
import { useState, useEffect, useCallback } from 'react';
import { PageHeader } from '@/components/ui/PageHeader';
import { Button } from '@/components/ui/Button';
import { Select } from '@/components/ui/Select';
import { LoadingSkeleton } from '@/components/ui/LoadingSkeleton';
import { StatCard } from '@/components/ui/StatCard';
import { formatCurrency } from '@/lib/utils';
import { Download, FileText } from 'lucide-react';
import { Download, FileText, RefreshCw } from 'lucide-react';

const TYPE_LABELS: Record<string, string> = {
  asset: 'أصل',
  liability: 'خصم',
  equity: 'ملكية',
  revenue: 'إيراد',
  expense: 'مصروف',
};

function todayISO() {
  return new Date().toISOString().split('T')[0];
}
function yearStartISO() {
  return `${new Date().getFullYear()}-01-01`;
}

function downloadCsv(filename: string, headers: string[], rows: (string | number)[][]) {
  const esc = (v: string | number) => `"${String(v ?? '').replace(/"/g, '""')}"`;
  const csv = '\uFEFF' + [headers.map(esc).join(','), ...rows.map((r) => r.map(esc).join(','))].join('\n');
  const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}

export default function ReportsPage() {
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [tab, setTab] = useState('trial_balance');
  const [trialBalance, setTrialBalance] = useState<any[]>([]);
  const [from, setFrom] = useState(yearStartISO());
  const [to, setTo] = useState(todayISO());
  const [trialBalance, setTrialBalance] = useState<any>(null);
  const [incomeStatement, setIncomeStatement] = useState<any>(null);
  const [balanceSheet, setBalanceSheet] = useState<any>(null);
  const [profitability, setProfitability] = useState<any>(null);
  const [aging, setAging] = useState<any>(null);
  const [agingType, setAgingType] = useState('ar');
  const [operational, setOperational] = useState<any>(null);
  const [opType, setOpType] = useState('project-costs');
  const [projects, setProjects] = useState<any[]>([]);
  const [projectId, setProjectId] = useState('');
  const [cashFlow, setCashFlow] = useState<any>(null);
  const [ledger, setLedger] = useState<any>(null);
  const [ledgerAccounts, setLedgerAccounts] = useState<any[]>([]);
  const [ledgerAccountId, setLedgerAccountId] = useState('');
  const [vat, setVat] = useState<any>(null);

  useEffect(() => {
    const fetchData = async () => {
      try {
        setLoading(true);
        const res = await fetch(`/api/reports/financial?type=${tab === 'income_statement' ? 'income_statement' : 'trial_balance'}`);
  const qs = (extra: Record<string, string> = {}) => {
    const p = new URLSearchParams({ from, to, ...extra });
    return p.toString();
  };

  const load = useCallback(async () => {
    setLoading(true);
    setError('');
    try {
      if (tab === 'trial_balance' || tab === 'income_statement' || tab === 'balance_sheet') {
        const type = tab;
        const res = await fetch(`/api/reports/financial?type=${type}&${qs()}`);
        const json = await res.json();
        if (json.success) {
          if (tab === 'income_statement') {
            setIncomeStatement(json.data || null);
          } else {
            setTrialBalance(json.data?.accounts || []);
          }
        } else {
          setError(json.message || 'فشل تحميل البيانات');
        }
      } catch {
        setError('فشل تحميل البيانات');
      } finally {
        setLoading(false);
        if (!json.success) throw new Error(json.message || 'فشل تحميل التقرير');
        if (tab === 'trial_balance') setTrialBalance(json.data);
        if (tab === 'income_statement') setIncomeStatement(json.data);
        if (tab === 'balance_sheet') setBalanceSheet(json.data);
      } else if (tab === 'profitability') {
        const res = await fetch(`/api/reports/profitability?${qs()}`);
        const json = await res.json();
        if (!json.success) throw new Error(json.message || 'فشل تحميل التقرير');
        setProfitability(json.data);
      } else if (tab === 'aging') {
        const res = await fetch(`/api/reports/aging?type=${agingType}&asOf=${to}`);
        const json = await res.json();
        if (!json.success) throw new Error(json.message || 'فشل تحميل التقرير');
        setAging(json.data);
      } else if (tab === 'operational') {
        const extra: Record<string, string> = { type: opType };
        if (projectId) extra.projectId = projectId;
        const res = await fetch(`/api/reports/operational?${qs(extra)}`);
        const json = await res.json();
        if (!json.success) throw new Error(json.message || 'فشل تحميل التقرير');
        setOperational(json.data);
      } else if (tab === 'cash_flow') {
        const res = await fetch(`/api/reports/cash-flow?${qs()}`);
        const json = await res.json();
        if (!json.success) throw new Error(json.message || 'فشل تحميل التقرير');
        setCashFlow(json.data);
      } else if (tab === 'general_ledger') {
        const extra: Record<string, string> = {};
        if (ledgerAccountId) extra.account_id = ledgerAccountId;
        const res = await fetch(`/api/reports/general-ledger?${qs(extra)}`);
        const json = await res.json();
        if (!json.success) throw new Error(json.message || 'فشل تحميل التقرير');
        setLedger(json.data);
      } else if (tab === 'vat') {
        const res = await fetch(`/api/reports/vat?${qs()}`);
        const json = await res.json();
        if (!json.success) throw new Error(json.message || 'فشل تحميل التقرير');
        setVat(json.data);
      }
    };
    fetchData();
  }, [tab]);
    } catch (e: any) {
      setError(e?.message || 'فشل تحميل البيانات');
    } finally {
      setLoading(false);
    }
  }, [tab, from, to, agingType, opType, projectId, ledgerAccountId]);

  useEffect(() => { load(); }, [load]);

  useEffect(() => {
    fetch('/api/projects').then((r) => r.json()).then((j) => {
      if (j.success) setProjects(j.data?.rows || j.data?.projects || []);
    }).catch(() => {});
    fetch('/api/accounts').then((r) => r.json()).then((j) => {
      if (!j.success) return;
      const flat: any[] = [];
      const walk = (nodes: any[]) => {
        for (const n of nodes || []) {
          if (!n.is_header) flat.push(n);
          if (n.children?.length) walk(n.children);
        }
      };
      walk(j.data?.accounts || []);
      setLedgerAccounts(flat);
    }).catch(() => {});
  }, []);

  const handleExport = () => {
    if (tab === 'trial_balance' && trialBalance?.accounts) {
      downloadCsv('trial-balance.csv', ['الكود', 'الحساب', 'النوع', 'مدين', 'دائن', 'الرصيد'],
        trialBalance.accounts.map((a: any) => [a.code, a.name, a.type, a.total_debit, a.total_credit, a.balance]));
    } else if (tab === 'income_statement' && incomeStatement) {
      downloadCsv('income-statement.csv', ['الكود', 'الحساب', 'النوع', 'المبلغ'], [
        ...(incomeStatement.revenue || []).map((r: any) => [r.code, r.name, 'إيراد', r.amount]),
        ...(incomeStatement.expenses || []).map((r: any) => [r.code, r.name, 'مصروف', r.amount]),
      ]);
    } else if (tab === 'profitability' && profitability?.projects) {
      downloadCsv('profitability.csv', ['المشروع', 'التعاقد', 'الإيراد', 'التكلفة', 'الربح', 'الهامش %'],
        profitability.projects.map((p: any) => [p.name, p.contract_value, p.revenue, p.total_costs, p.profit, p.profit_margin?.toFixed?.(1)]));
    } else if (tab === 'aging' && aging?.aging) {
      downloadCsv('aging.csv', ['الاسم', 'الرصيد', '0-30', '31-60', '61-90', '90+'],
        aging.aging.map((r: any) => [r.name, r.balance, r.buckets?.['0-30'], r.buckets?.['31-60'], r.buckets?.['61-90'], r.buckets?.['90+']]));
    } else if (tab === 'balance_sheet' && balanceSheet) {
      downloadCsv('balance-sheet.csv', ['القسم', 'الكود', 'الحساب', 'الرصيد'], [
        ...(balanceSheet.assets || []).map((r: any) => ['أصول', r.code, r.name, r.balance]),
        ...(balanceSheet.liabilities || []).map((r: any) => ['خصوم', r.code, r.name, r.balance]),
        ...(balanceSheet.equity || []).map((r: any) => ['ملكية', r.code, r.name, r.balance]),
      ]);
    }
  };

  const tbCols = [
    { key: 'code', label: 'الكود', sortable: true },
    { key: 'name', label: 'الحساب', sortable: true },
    { key: 'type', label: 'النوع', render: (row: any) => <Badge variant="info">{row.type}</Badge> },
    { key: 'type', label: 'النوع', render: (row: any) => <Badge variant="info">{TYPE_LABELS[row.type] || row.type}</Badge> },
    { key: 'total_debit', label: 'مجموع مدين', render: (row: any) => formatCurrency(row.total_debit) },
    { key: 'total_credit', label: 'مجموع دائن', render: (row: any) => formatCurrency(row.total_credit) },
    { key: 'balance', label: 'الرصيد', render: (row: any) => <span className={row.balance < 0 ? 'text-danger' : 'text-success'}>{formatCurrency(Math.abs(row.balance))}</span> },
    { key: 'balance', label: 'الرصيد', render: (row: any) => <span className={row.balance < 0 ? 'text-danger' : 'text-success'}>{formatCurrency(row.balance)}</span> },
  ];

  const incomeCols = [
    { key: 'code', label: 'الكود' }, { key: 'name', label: 'الحساب' },
    { key: 'amount', label: 'المبلغ', render: (row: any) => formatCurrency(row.amount) },
  const moneyCols = [
    { key: 'code', label: 'الكود' },
    { key: 'name', label: 'الحساب' },
    { key: 'amount', label: 'المبلغ', render: (row: any) => formatCurrency(row.amount ?? row.balance) },
  ];

  if (loading) return <LoadingSkeleton variant="card" count={4} />;

  if (error) {
    return (
      <div className="space-y-6">
        <PageHeader title="التقارير" description="التقارير المالية والمحاسبية"
          actions={<Button variant="secondary" leftIcon={<Download size={16} />}>تصدير</Button>}
        />
        <div className="bg-danger/10 border border-danger/30 rounded-lg p-4 text-danger">{error}</div>
      </div>
    );
  }
  const bsCols = [
    { key: 'code', label: 'الكود' },
    { key: 'name', label: 'الحساب' },
    { key: 'balance', label: 'الرصيد', render: (row: any) => formatCurrency(row.balance) },
  ];

  return (
    <div className="space-y-6">
      <PageHeader title="التقارير" description="التقارير المالية والمحاسبية"
        actions={<Button variant="secondary" leftIcon={<Download size={16} />}>تصدير</Button>}
      <PageHeader title="التقارير" description="تقارير مالية مبنية على القيود الفعلية — ليست أرقاماً تجريبية"
        actions={
          <div className="flex gap-2">
            <Button variant="secondary" leftIcon={<RefreshCw size={16} />} onClick={load}>تحديث</Button>
            <Button variant="secondary" leftIcon={<Download size={16} />} onClick={handleExport}>تصدير CSV</Button>
          </div>
        }
      />

      <div className="flex flex-wrap gap-4 items-end">
        <Input label="من تاريخ" type="date" value={from} onChange={(e: any) => setFrom(e.target.value)} />
        <Input label="إلى تاريخ" type="date" value={to} onChange={(e: any) => setTo(e.target.value)} />
      </div>

      <Tabs items={[
        { id: 'trial_balance', label: 'ميزان المراجعة' },
        { id: 'income_statement', label: 'قائمة الدخل' },
        { id: 'balance_sheet', label: 'الميزانية العمومية' },
        { id: 'general_ledger', label: 'الأستاذ العام' },
        { id: 'cash_flow', label: 'التدفقات النقدية' },
        { id: 'profitability', label: 'ربحية المشاريع' },
        { id: 'aging', label: 'التقادم الزمني' },
        { id: 'vat', label: 'ضريبة القيمة المضافة' },
        { id: 'operational', label: 'تقارير تشغيلية' },
      ]} activeTab={tab} onChange={setTab} />

      {tab === 'trial_balance' && (
      {error && <div className="bg-danger/10 border border-danger/30 rounded-lg p-4 text-danger">{error}</div>}
      {loading && <LoadingSkeleton variant="card" count={3} />}

      {!loading && !error && tab === 'trial_balance' && (
        <div className="space-y-4">
          <div className="flex gap-4">
            <Input label="من تاريخ" type="date" />
            <Input label="إلى تاريخ" type="date" />
          <div className="grid grid-cols-2 gap-4">
            <StatCard title="إجمالي المدين" value={formatCurrency(trialBalance?.total_debit || 0)} accentColor="var(--color-info)" />
            <StatCard title="إجمالي الدائن" value={formatCurrency(trialBalance?.total_credit || 0)} accentColor="var(--color-accent)" />
          </div>
          {trialBalance.length === 0 ? (
            <p className="text-text-muted text-center py-8">لا توجد بيانات</p>
          {(trialBalance?.accounts || []).length === 0 ? (
            <p className="text-text-muted text-center py-8">لا توجد قيود في الفترة المحددة</p>
          ) : (
            <Table columns={tbCols} data={trialBalance} />
            <Table columns={tbCols} data={trialBalance.accounts} />
          )}
        </div>
      )}

      {tab === 'income_statement' && (
      {!loading && !error && tab === 'income_statement' && (
        <div className="space-y-6">
          {incomeStatement ? (
            <>
                <StatCard title="إجمالي المصروفات" value={formatCurrency(incomeStatement.total_expenses || 0)} accentColor="var(--color-danger)" />
                <StatCard title="صافي الدخل" value={formatCurrency(incomeStatement.net_income || 0)} accentColor="var(--color-accent)" />
              </div>
              <Card title="الإيرادات"><Table columns={incomeCols} data={incomeStatement.revenue || []} /></Card>
              <Card title="المصروفات"><Table columns={incomeCols} data={incomeStatement.expenses || []} /></Card>
              <Card title="الإيرادات"><Table columns={moneyCols} data={(incomeStatement.revenue || []).filter((r: any) => r.amount)} /></Card>
              <Card title="المصروفات"><Table columns={moneyCols} data={(incomeStatement.expenses || []).filter((r: any) => r.amount)} /></Card>
            </>
          ) : (
            <p className="text-text-muted text-center py-8">لا توجد بيانات</p>
          )}
        </div>
      )}

      {!loading && !error && tab === 'balance_sheet' && (
        <div className="space-y-6">
          {balanceSheet ? (
            <>
              <div className="grid grid-cols-3 gap-4">
                <StatCard title="إجمالي الأصول" value={formatCurrency(balanceSheet.total_assets || 0)} accentColor="var(--color-info)" />
                <StatCard title="إجمالي الخصوم" value={formatCurrency(balanceSheet.total_liabilities || 0)} accentColor="var(--color-warning)" />
                <StatCard title="حقوق الملكية" value={formatCurrency(balanceSheet.total_equity || 0)} accentColor="var(--color-accent)" />
              </div>
              <p className="text-sm text-text-muted">
                المعادلة: أصول = خصوم + حقوق ملكية
                {Math.abs((balanceSheet.total_assets || 0) - ((balanceSheet.total_liabilities || 0) + (balanceSheet.total_equity || 0))) < 0.05
                  ? ' — متوازنة'
                  : ` — فرق ${formatCurrency((balanceSheet.total_assets || 0) - ((balanceSheet.total_liabilities || 0) + (balanceSheet.total_equity || 0)))}`}
              </p>
              <Card title="الأصول"><Table columns={bsCols} data={balanceSheet.assets || []} /></Card>
              <Card title="الخصوم"><Table columns={bsCols} data={balanceSheet.liabilities || []} /></Card>
              <Card title="حقوق الملكية"><Table columns={bsCols} data={balanceSheet.equity || []} /></Card>
            </>
          ) : (
            <p className="text-text-muted text-center py-8">لا توجد بيانات</p>
        </div>
      )}

      {tab === 'profitability' && (
        <div>
          <p className="text-text-muted">تقرير ربحية المشاريع - قيد التطوير</p>
      {!loading && !error && tab === 'general_ledger' && (
        <div className="space-y-4">
          <Select
            label="الحساب"
            value={ledgerAccountId}
            onChange={setLedgerAccountId}
            options={[{ value: '', label: 'كل الحسابات' }, ...ledgerAccounts.map((a) => ({ value: a.id, label: `${a.code} — ${a.name}` }))]}
          />
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-4">
            <StatCard title="رصيد افتتاحي" value={formatCurrency(ledger?.opening_balance || 0)} />
            <StatCard title="مدين" value={formatCurrency(ledger?.total_debit || 0)} />
            <StatCard title="دائن" value={formatCurrency(ledger?.total_credit || 0)} />
            <StatCard title="رصيد ختامي" value={formatCurrency(ledger?.closing_balance || 0)} />
          </div>
          <Table
            columns={[
              { key: 'date', label: 'التاريخ' },
              { key: 'number', label: 'رقم القيد' },
              { key: 'account_code', label: 'الحساب' },
              { key: 'description', label: 'البيان' },
              { key: 'debit', label: 'مدين', render: (r: any) => formatCurrency(r.debit) },
              { key: 'credit', label: 'دائن', render: (r: any) => formatCurrency(r.credit) },
              { key: 'balance', label: 'الرصيد', render: (r: any) => formatCurrency(r.balance) },
            ]}
            data={ledger?.transactions || []}
          />
        </div>
      )}

      {!loading && !error && tab === 'cash_flow' && (
        <div className="space-y-4">
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-4">
            <StatCard title="رصيد أول المدة" value={formatCurrency(cashFlow?.opening_balance || 0)} />
            <StatCard title="تشغيلي" value={formatCurrency(cashFlow?.operating?.net || 0)} accentColor="var(--color-info)" />
            <StatCard title="استثماري" value={formatCurrency(cashFlow?.investing?.net || 0)} />
            <StatCard title="رصيد آخر المدة" value={formatCurrency(cashFlow?.closing_balance || 0)} accentColor="var(--color-success)" />
          </div>
          <Card title="الأنشطة التشغيلية — مقبوضات">
            <Table columns={[
              { key: 'account_name', label: 'الحساب' },
              { key: 'description', label: 'البيان' },
              { key: 'amount', label: 'المبلغ', render: (r: any) => formatCurrency(r.amount) },
            ]} data={cashFlow?.operating?.inflows || []} />
          </Card>
          <Card title="الأنشطة التشغيلية — مدفوعات">
            <Table columns={[
              { key: 'account_name', label: 'الحساب' },
              { key: 'description', label: 'البيان' },
              { key: 'amount', label: 'المبلغ', render: (r: any) => formatCurrency(r.amount) },
            ]} data={cashFlow?.operating?.outflows || []} />
          </Card>
        </div>
      )}

      {!loading && !error && tab === 'profitability' && (
        <div className="space-y-4">
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-4">
            <StatCard title="قيمة التعاقدات" value={formatCurrency(profitability?.totals?.contract_value || 0)} />
            <StatCard title="الإيراد المحقق" value={formatCurrency(profitability?.totals?.revenue || 0)} accentColor="var(--color-success)" />
            <StatCard title="التكاليف" value={formatCurrency(profitability?.totals?.total_costs || 0)} accentColor="var(--color-danger)" />
            <StatCard title="صافي الربح" value={formatCurrency(profitability?.totals?.profit || 0)} accentColor="var(--color-accent)" />
          </div>
          <Table
            columns={[
              { key: 'name', label: 'المشروع' },
              { key: 'client_name', label: 'العميل' },
              { key: 'contract_value', label: 'التعاقد', render: (r: any) => formatCurrency(r.contract_value) },
              { key: 'revenue', label: 'الإيراد', render: (r: any) => formatCurrency(r.revenue) },
              { key: 'total_costs', label: 'التكلفة', render: (r: any) => formatCurrency(r.total_costs) },
              { key: 'profit', label: 'الربح', render: (r: any) => <span className={r.profit < 0 ? 'text-danger' : 'text-success'}>{formatCurrency(r.profit)}</span> },
              { key: 'profit_margin', label: 'الهامش', render: (r: any) => `${(r.profit_margin || 0).toFixed(1)}%` },
            ]}
            data={profitability?.projects || []}
          />
        </div>
      )}

      {tab === 'aging' && (
        <div>
          <p className="text-text-muted">تقرير التقادم الزمني للذمم - قيد التطوير</p>
      {!loading && !error && tab === 'aging' && (
        <div className="space-y-4">
          <Select
            label="النوع"
            value={agingType}
            onChange={setAgingType}
            options={[
              { value: 'ar', label: 'ذمم العملاء (مدينون)' },
              { value: 'ap', label: 'ذمم الموردين (دائنون)' },
            ]}
          />
          <div className="grid grid-cols-2 sm:grid-cols-5 gap-4">
            <StatCard title="الإجمالي" value={formatCurrency(aging?.totals?.balance || 0)} />
            <StatCard title="0-30 يوم" value={formatCurrency(aging?.totals?.['0-30'] || 0)} />
            <StatCard title="31-60" value={formatCurrency(aging?.totals?.['31-60'] || 0)} />
            <StatCard title="61-90" value={formatCurrency(aging?.totals?.['61-90'] || 0)} />
            <StatCard title="أكثر من 90" value={formatCurrency(aging?.totals?.['90+'] || 0)} accentColor="var(--color-danger)" />
          </div>
          <Table
            columns={[
              { key: 'name', label: 'الاسم' },
              { key: 'balance', label: 'الرصيد', render: (r: any) => formatCurrency(r.balance) },
              { key: 'b0', label: '0-30', render: (r: any) => formatCurrency(r.buckets?.['0-30'] || 0) },
              { key: 'b1', label: '31-60', render: (r: any) => formatCurrency(r.buckets?.['31-60'] || 0) },
              { key: 'b2', label: '61-90', render: (r: any) => formatCurrency(r.buckets?.['61-90'] || 0) },
              { key: 'b3', label: '90+', render: (r: any) => formatCurrency(r.buckets?.['90+'] || 0) },
              { key: 'days_overdue', label: 'أيام التأخير' },
            ]}
            data={aging?.aging || []}
          />
        </div>
      )}

      {tab === 'operational' && (
      {!loading && !error && tab === 'vat' && (
        <div className="space-y-4">
          <div className="flex gap-4">
            <Select label="نوع التقرير" options={[
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-4">
            <StatCard title="ضريبة مخرجات" value={formatCurrency(vat?.summary?.total_vat_collected || 0)} />
            <StatCard title="ضريبة مدخلات" value={formatCurrency(vat?.summary?.total_vat_paid || 0)} />
            <StatCard title="الضريبة المستحقة" value={formatCurrency(vat?.summary?.vat_payable || 0)} accentColor="var(--color-accent)" />
            <StatCard title="المبيعات بدون ضريبة" value={formatCurrency(vat?.summary?.total_sales_excluding_vat || 0)} />
          </div>
          <p className="text-sm text-text-muted">
            الحالة: {vat?.summary?.vat_payable_status === 'refundable' ? 'رصيد قابل للاسترداد' : 'مستحق السداد'} — نسبة الضريبة {(vat?.vat_rate || 0.15) * 100}%
          </p>
        </div>
      )}

      {!loading && !error && tab === 'operational' && (
        <div className="space-y-4">
          <div className="flex flex-wrap gap-4">
            <Select label="نوع التقرير" value={opType} onChange={setOpType} options={[
              { value: 'project-costs', label: 'تكاليف المشاريع' },
              { value: 'material-issuances', label: 'صرف المواد' },
              { value: 'inventory-transfers', label: 'تحويلات مخزنية' },
            ]} />
            <Select label="المشروع" options={[{ value: '', label: 'الكل' }]} />
            <Button variant="secondary" leftIcon={<FileText size={16} />}>عرض</Button>
            <Select label="المشروع" value={projectId} onChange={setProjectId} options={[
              { value: '', label: 'كل المشاريع' },
              ...projects.map((p: any) => ({ value: p.id, label: p.name })),
            ]} />
            <Button variant="secondary" leftIcon={<FileText size={16} />} onClick={load}>عرض</Button>
          </div>
          <Card title="تفاصيل التكاليف التشغيلية">
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-4">
              <StatCard title="تكاليف المواد" value={formatCurrency(85000)} accentColor="var(--color-info)" />
              <StatCard title="تكاليف العمالة" value={formatCurrency(45000)} accentColor="var(--color-warning)" />
              <StatCard title="المشتريات" value={formatCurrency(120000)} accentColor="var(--color-accent)" />
              <StatCard title="مقاولو الباطن" value={formatCurrency(65000)} accentColor="var(--color-success)" />
          {opType === 'project-costs' && operational && !Array.isArray(operational) && (
            <div className="grid grid-cols-2 sm:grid-cols-5 gap-4">
              <StatCard title="تكاليف المواد" value={formatCurrency(operational.materials || 0)} accentColor="var(--color-info)" />
              <StatCard title="تكاليف العمالة" value={formatCurrency(operational.workers || 0)} accentColor="var(--color-warning)" />
              <StatCard title="المشتريات" value={formatCurrency(operational.purchases || 0)} accentColor="var(--color-accent)" />
              <StatCard title="مقاولو الباطن" value={formatCurrency(operational.subcontractors || 0)} accentColor="var(--color-success)" />
              <StatCard title="الإجمالي" value={formatCurrency(operational.total || 0)} />
            </div>
          </Card>
        </div>
      )}

      {tab === 'balance_sheet' && (
        <div>
          <p className="text-text-muted">الميزانية العمومية - قيد التطوير</p>
          )}
          {Array.isArray(operational) && (
            <Table
              columns={[
                { key: 'date', label: 'التاريخ' },
                { key: 'item_name', label: 'الصنف' },
                { key: 'project_name', label: 'المشروع' },
                { key: 'type', label: 'النوع' },
                { key: 'quantity', label: 'الكمية' },
                { key: 'total_value', label: 'القيمة', render: (r: any) => formatCurrency(r.total_value || 0) },
              ]}
              data={operational}
            />
          )}
        </div>
      )}
    </div>

src/app/(dashboard)/salary-sheets/page.tsx
+13
−16
import { LoadingSkeleton } from '@/components/ui/LoadingSkeleton';
import { ActionButtons } from '@/components/ui/ActionButtons';
import { formatDate, formatCurrency } from '@/lib/utils';
import { fetchRecord, applyDates, recordOrRow } from '@/lib/form-utils';
import { toast } from '@/components/ui/Toast';

export default function SalarySheetsPage() {
  const [sheets, setSheets] = useState<any[]>([]);
  };

  const handleEdit = async (sheet: any) => {
    try {
      const res = await fetch(`/api/salary-sheets/${sheet.id}`);
      const json = await res.json();
      if (json.success) {
        setEditingSheet(sheet);
        setForm({
          name: json.data.name,
          month: json.data.month,
          year: json.data.year,
          date: json.data.date,
        });
        setShowModal(true);
      }
    } catch (e) {
      console.error('Failed to load sheet:', e);
    }
    const { data, error } = await fetchRecord(`/api/salary-sheets/${sheet.id}`);
    const src = recordOrRow(data, sheet);
    if (!data && error) toast.error(error);
    setEditingSheet(sheet);
    setForm(applyDates({
      name: src.name || '',
      month: src.month || 1,
      year: src.year || new Date().getFullYear(),
      date: src.date,
    }, ['date']));
    setShowModal(true);
  };

  const handleDelete = async (sheet: any) => {

src/app/(dashboard)/users/page.tsx
+1
−1
          password: '',
          role: d.role || 'accountant',
          phone: d.phone || '',
          birth_date: d.birth_date || '',
          birth_date: (d.birth_date || '').toString().slice(0, 10),
          city: d.city || '',
        });
        setShowModal(true);

src/app/(dashboard)/vouchers/disbursement/page.tsx
+15
−22
import { ActionButtons } from '@/components/ui/ActionButtons';
import { toast } from '@/components/ui/Toast';
import { formatDate, formatCurrency } from '@/lib/utils';
import { fetchRecord, applyDates, recordOrRow } from '@/lib/form-utils';

export default function DisbursementPage() {
  const [disbursements, setDisbursements] = useState<any[]>([]);
  };

  const handleEdit = async (disbursement: any) => {
    try {
      const res = await fetch(`/api/vouchers/disbursement/${disbursement.id}`);
      const json = await res.json();
      if (json.success) {
        setEditingDisbursement(disbursement);
        setForm({
          date: json.data.date,
          disbursement_type: json.data.disbursement_type,
          bank_safe_id: json.data.bank_safe_id,
          contact_id: json.data.contact_id || '',
          employee_id: json.data.employee_id || '',
          amount: json.data.amount,
          reason: json.data.reason || '',
        });
        setShowModal(true);
      } else {
        toast.error(json.message || 'فشل تحميل السند');
      }
    } catch (err) {
      console.error('Failed to load disbursement:', err);
      toast.error('خطأ في تحميل السند');
    }
    const { data, error } = await fetchRecord(`/api/vouchers/disbursement/${disbursement.id}`);
    const src = recordOrRow(data, disbursement);
    if (!data && error) toast.error(error);
    setEditingDisbursement(disbursement);
    setForm(applyDates({
      date: src.date,
      disbursement_type: src.disbursement_type || 'supplier',
      bank_safe_id: src.bank_safe_id || '',
      contact_id: src.contact_id || '',
      employee_id: src.employee_id || '',
      amount: src.amount || 0,
      reason: src.reason || '',
    }, ['date']));
    setShowModal(true);
  };

  const handleDelete = async (disbursement: any) => {

src/app/(dashboard)/vouchers/receipt/page.tsx
+15
−18
import { LoadingSkeleton } from '@/components/ui/LoadingSkeleton';
import { ActionButtons } from '@/components/ui/ActionButtons';
import { formatDate, formatCurrency } from '@/lib/utils';
import { fetchRecord, applyDates, recordOrRow } from '@/lib/form-utils';
import { toast } from '@/components/ui/Toast';

export default function ReceiptPage() {
  const [receipts, setReceipts] = useState<any[]>([]);
  };

  const handleEdit = async (receipt: any) => {
    try {
      const res = await fetch(`/api/vouchers/receipt/${receipt.id}`);
      const json = await res.json();
      if (json.success) {
        setEditingReceipt(receipt);
        setForm({
          date: json.data.date,
          receipt_type: json.data.receipt_type,
          bank_safe_id: json.data.bank_safe_id,
          contact_id: json.data.contact_id || '',
          amount: json.data.amount,
          reason: json.data.reason || '',
        });
        setShowModal(true);
      }
    } catch (e) {
      console.error('Failed to load receipt:', e);
    }
    const { data, error } = await fetchRecord(`/api/vouchers/receipt/${receipt.id}`);
    const src = recordOrRow(data, receipt);
    if (!data && error) toast.error(error);
    setEditingReceipt(receipt);
    setForm(applyDates({
      date: src.date,
      receipt_type: src.receipt_type || 'client',
      bank_safe_id: src.bank_safe_id || '',
      contact_id: src.contact_id || '',
      amount: src.amount || 0,
      reason: src.reason || '',
    }, ['date']));
    setShowModal(true);
  };

  const handleDelete = async (receipt: any) => {

src/app/api/accounts/route.ts
+28
−7
    const auth = await requireModulePermission(request, 'accounts', 'read');
    const s = sb();

    const accountSelect = 'id, code, name, name_en, type, parent_id, is_active, is_header, created_at';
    let { data, error: queryError } = await s.from('accounts')
      .select('id, code, name, name_en, type, parent_id, is_active, created_at')
      .select(accountSelect)
      .eq('company_id', auth.companyId)
      .order('code');

    if (queryError && /is_header|42703|Could not find/i.test(queryError.message || '')) {
      const fallback = await s.from('accounts')
        .select('id, code, name, name_en, type, parent_id, is_active, created_at')
        .eq('company_id', auth.companyId)
        .order('code');
      data = fallback.data;
      queryError = fallback.error;
    }

    if (queryError) throw queryError;

    // AUTO-SEED: إذا لم تكن شجرة الحسابات موجودة للشركة، أنشئ الشجرة الافتراضية تلقائياً
    if (!data || data.length === 0) {
      const { createDefaultChartOfAccounts } = await import('@/lib/default-accounts');
    const { DEFAULT_CHART_OF_ACCOUNTS, createDefaultChartOfAccounts, ensureDefaultCashSafe } = await import('@/lib/default-accounts');
    const existingCodes = new Set((data || []).map((a: any) => a.code));
    const missingDefaults = DEFAULT_CHART_OF_ACCOUNTS.some((a) => !existingCodes.has(a.code));
    if (!data || data.length === 0 || missingDefaults) {
      await createDefaultChartOfAccounts(s, auth.companyId);

      const refetch = await s.from('accounts')
        .select('id, code, name, name_en, type, parent_id, is_active, created_at')
        .select(accountSelect)
        .eq('company_id', auth.companyId)
        .order('code');
      data = refetch.data || [];
    } else {
      await ensureDefaultCashSafe(s, auth.companyId);
    }

    const accounts: any[] = (data || []).map((a: any) => ({ ...a, children: [] as any[] }));
    const { HEADER_ACCOUNT_CODES } = await import('@/lib/account-resolve');
    const accounts: any[] = (data || []).map((a: any) => ({
      ...a,
      is_header: a.is_header === true || HEADER_ACCOUNT_CODES.has(a.code),
      children: [] as any[],
    }));
    const accountMap = new Map(accounts.map((a: any) => [a.id, a]));
    const roots: any[] = [];

      }
    }

    for (const acc of accounts) {
      if (acc.children.length > 0) acc.is_header = true;
    }

    return success({ accounts: roots }, 200, { cache: 'private', maxAge: 300, staleWhileRevalidate: 60 });
  } catch (err) {
    return handleApiError(err);

src/app/api/auth/cleanup-inactive/route.ts
+16
−2
    const authHeader = request.headers.get('authorization') || '';
    const cronSecret = authHeader.replace('Bearer ', '') || request.headers.get('x-cron-secret');

    if (cronSecret !== process.env.CRON_SECRET) {
    const expected = process.env.CRON_SECRET;
    if (!expected) {
      return error('CRON_SECRET غير مضبوط — العملية مرفوضة', 401);
    }
    if (!cronSecret || cronSecret.length !== expected.length) {
      return error('غير مصرح', 401);
    }
    let diff = 0;
    for (let i = 0; i < expected.length; i++) diff |= cronSecret.charCodeAt(i) ^ expected.charCodeAt(i);
    if (diff !== 0) return error('غير مصرح', 401);
    return await doCleanup();
  } catch (err) {
    return serverError(err);
export async function POST(request: NextRequest) {
  try {
    const cronSecret = request.headers.get('x-cron-secret');
    if (cronSecret !== process.env.CRON_SECRET) {
    const expected = process.env.CRON_SECRET;
    if (!expected) {
      return error('CRON_SECRET غير مضبوط — العملية مرفوضة', 401);
    }
    if (!cronSecret || cronSecret.length !== expected.length) {
      return error('غير مصرح', 401);
    }
    let diff = 0;
    for (let i = 0; i < expected.length; i++) diff |= cronSecret.charCodeAt(i) ^ expected.charCodeAt(i);
    if (diff !== 0) return error('غير مصرح', 401);
    return await doCleanup();
  } catch (err) {
    return serverError(err);

src/app/api/cash/[id]/route.ts
+7
−1
    const { id } = await params;
    const s = sb();

    const { data, error: queryError } = await s.from('cash_transactions')
    let { data, error: queryError } = await s.from('cash_transactions')
      .select('*, banks_safes(name), accounts(name), contacts(name), journal_entries(number)')
      .eq('id', id)
      .eq('company_id', auth.companyId)
      .maybeSingle();
    if (queryError) {
      const fallback = await s.from('cash_transactions')
        .select('*').eq('id', id).eq('company_id', auth.companyId).maybeSingle();
      data = fallback.data;
      queryError = fallback.error;
    }

    if (queryError || !data) {
      return notFound();

src/app/api/cash/route.ts
+22
−9
        *,
        accounts(name),
        transaction_categories(name),
        bank_safes(name),
        banks_safes(name),
        contacts(name)
      `, { count: 'exact' })
      .eq('company_id', auth.companyId);
      return success({ transactions: [], total: 0, page, pageSize, totalPages: 0 });
    }

    const transactions = (result.data || []).map((t: any) => ({
      ...t,
      account_name: t.accounts?.name || t.account_name || null,
      bank_name: t.banks_safes?.name || t.bank_name || null,
      contact_name: t.contacts?.name || t.contact_name || null,
    }));

    return success({
      transactions: result.data || [],
      transactions,
      rows: transactions,
      total: result.count || 0,
      page,
      pageSize,
      tax_enabled,
    } = body;

    if (!date || !type || !amount || !reason) {
    const normalizedType = type === 'receipt' ? 'revenue' : type;
    if (!date || !normalizedType || !amount || !reason) {
      return error('التاريخ، النوع، المبلغ، والسبب مطلوبة', 400);
    }
    if (normalizedType !== 'revenue' && normalizedType !== 'expense') {
      return error('نوع الحركة يجب أن يكون قبض أو صرف', 400);
    }

    if (parseFloat(amount) <= 0) {
      return error('المبلغ يجب أن يكون أكبر من صفر', 400);
    }
    const txnType = normalizedType;

    // Get account info if specified
    let accountInfo = null;

    // Determine credit account based on transaction type
    let creditAccountCode: string | null = null;
    if (type === 'revenue') {
    if (txnType === 'revenue') {
      creditAccountCode = ACCOUNT_CODES.CONTRACT_REVENUE;
    } else if (type === 'expense') {
    } else if (txnType === 'expense') {
      creditAccountCode = ACCOUNT_CODES.DIRECT_COSTS;
    } else if (bankSafeInfo?.account_id) {
      creditAccountCode = null; // use bank account itself
    // VAT calculation
    const vRate = (tax_enabled && tax_rate) ? tax_rate : 0;
    const baseAmount = parseFloat(amount);
    const taxAmount = type === 'revenue' ? baseAmount * vRate / (1 + vRate) : 0;
    const taxAmount = txnType === 'revenue' ? baseAmount * vRate / (1 + vRate) : 0;
    // For revenue: amount includes VAT, so net = amount / (1+rate), VAT = amount - net
    // For expense: amount is the expense, VAT is extra
    const expenseTaxAmount = type === 'expense' ? baseAmount * vRate : 0;
    const totalPayment = type === 'expense' ? baseAmount + expenseTaxAmount : baseAmount;
    const expenseTaxAmount = txnType === 'expense' ? baseAmount * vRate : 0;
    const totalPayment = txnType === 'expense' ? baseAmount + expenseTaxAmount : baseAmount;

    // Insert cash transaction record
    const { data: transaction, error: insertErr } = await s.from('cash_transactions')
      .insert({
        company_id: auth.companyId,
        date,
        type,
        type: txnType,
        amount: baseAmount,
        account_id: debitAccountId || null,
        bank_safe_id: bankSafeId || null,

src/app/api/diagnostics/route.ts
+41
−2
import { success } from '@/lib/api-helpers';
import { NextRequest } from 'next/server';
import { success, error, handleApiError } from '@/lib/api-helpers';
import { getSupabase } from '@/lib/supabase-client';

function secretsMatch(provided: string | null, expected: string | undefined): boolean {
  if (!provided || !expected) return false;
  if (provided.length !== expected.length) return false;
  let diff = 0;
  for (let i = 0; i < provided.length; i++) {
    diff |= provided.charCodeAt(i) ^ expected.charCodeAt(i);
  }
  return diff === 0;
}

/**
 * GET /api/diagnostics
 * نقطة تشخيص ذاتية عامة (لا تكشف أسراراً ولا بيانات، فقط حالة جاهزية النظام).
 * - دوال RPC المطلوبة
 * - عدد المستخدمين (قاعدة فارغة = تسجيل دخول سيفشل دائماً)
 */
export async function GET() {
export async function GET(request: NextRequest) {
  try {
    const headerSecret = request.headers.get('x-diagnostics-secret')
      || request.headers.get('x-cron-secret')
      || (request.headers.get('authorization') || '').replace(/^Bearer\s+/i, '');
    const allowedSecret = process.env.DIAGNOSTICS_SECRET || process.env.CRON_SECRET;
    let authorized = secretsMatch(headerSecret, allowedSecret);

    if (!authorized) {
      try {
        const { requireAdmin, requireAdminAuth } = await import('@/lib/api-helpers');
        try {
          await requireAdminAuth(request);
          authorized = true;
        } catch {
          await requireAdmin(request);
          authorized = true;
        }
      } catch {
        authorized = false;
      }
    }

    if (!authorized) {
      return error('غير مصرح — التشخيص يتطلب تسجيل دخول المدير أو سر DIAGNOSTICS_SECRET', 401);
    }
  } catch (err) {
    return handleApiError(err);
  }
  const report: Record<string, any> = {
    ok: true,
    deployment: {

src/app/api/fiscal/[id]/close/route.ts
+6
−2
import { getSupabase } from '@/lib/supabase-client';
import { getNextJournalNumber } from '@/lib/numbering';
import { ACCOUNT_CODES } from '@/lib/constants';
import { insertJournalLines } from '@/lib/journal-utils';

const sb = () => getSupabase();

      if (jeErr) throw jeErr;
      const jeId = closingJe.id;

      const closingLines: any[] = [];
      const closingLines: Array<{ journal_entry_id: string; account_id: string; debit: number; credit: number }> = [];
      if (netIncome > 0) {
        for (const acc of (revenueAccounts || [])) {
          const bal = -(accountBalances[acc.id] || 0);
        }
        closingLines.push({ journal_entry_id: jeId, account_id: retainedAccount.id, debit: loss, credit: 0 });
      }
      if (closingLines.length > 0) await s.from('journal_lines').insert(closingLines);
      if (closingLines.length > 0) {
        const { error: jlErr } = await insertJournalLines(companyId, closingLines);
        if (jlErr) throw jlErr;
      }
    }

    const { error: updErr } = await s.from('fiscal_years')

src/app/api/fiscal/[id]/route.ts
+71
import { NextRequest } from 'next/server';
import { success, error, notFound, requireApiAuth, requireModulePermission, handleApiError } from '@/lib/api-helpers';
import { getSupabase } from '@/lib/supabase-client';

const sb = () => getSupabase();

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const auth = await requireApiAuth(request);
    const { id } = await params;
    const { data, error: qErr } = await sb().from('fiscal_years')
      .select('*').eq('id', id).eq('company_id', auth.companyId).maybeSingle();
    if (qErr) throw qErr;
    if (!data) return notFound();
    return success(data);
  } catch (err) {
    return handleApiError(err);
  }
}

export async function PUT(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const auth = await requireModulePermission(request, 'fiscal', 'update');
    const { id } = await params;
    const s = sb();
    const body = await request.json();

    const { data: existing } = await s.from('fiscal_years')
      .select('*').eq('id', id).eq('company_id', auth.companyId).maybeSingle();
    if (!existing) return notFound();
    if ((existing as any).status === 'closed') return error('لا يمكن تعديل سنة مالية مقفلة');

    const updateData: any = {};
    if (body.name !== undefined) updateData.name = body.name;
    if (body.start_date !== undefined) updateData.start_date = body.start_date;
    if (body.end_date !== undefined) updateData.end_date = body.end_date;

    const { data: updated, error: updErr } = await s.from('fiscal_years')
      .update(updateData).eq('id', id).eq('company_id', auth.companyId).select('*').single();
    if (updErr) throw updErr;
    return success(updated);
  } catch (err) {
    return handleApiError(err);
  }
}

export async function DELETE(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const auth = await requireModulePermission(request, 'fiscal', 'delete');
    const { id } = await params;
    const s = sb();
    const { data: existing } = await s.from('fiscal_years')
      .select('id, status').eq('id', id).eq('company_id', auth.companyId).maybeSingle();
    if (!existing) return notFound();
    if ((existing as any).status === 'closed') return error('لا يمكن حذف سنة مالية مقفلة');
    const { error: delErr } = await s.from('fiscal_years').delete().eq('id', id).eq('company_id', auth.companyId);
    if (delErr) throw delErr;
    return success({ deleted: true });
  } catch (err) {
    return handleApiError(err);
  }
}

src/app/api/fiscal/closing/route.ts
+16

        if (balance > 0) {
          const { error: lineErr } = await s.from('journal_lines').insert({
            company_id: auth.companyId,
            journal_entry_id: jeId,
            account_id: acc.id,
            account_code: acc.code,
            account_name: acc.name,
            debit: balance,
            credit: 0,
            description: `إقفال ${acc.name}`,

      // دائن: أرباح العام
      const { error: revEarningsErr } = await s.from('journal_lines').insert({
        company_id: auth.companyId,
        journal_entry_id: jeId,
        account_id: currentYearEarningsAcc.id,
        account_code: '3300',
        account_name: 'أرباح العام',
        debit: 0,
        credit: totalRevenue,
        description: 'نقل الإيرادات إلى أرباح العام',

      // مدين: أرباح العام
      const { error: expEarningsErr } = await s.from('journal_lines').insert({
        company_id: auth.companyId,
        journal_entry_id: jeId,
        account_id: currentYearEarningsAcc.id,
        account_code: '3300',
        account_name: 'أرباح العام',
        debit: totalExpenses,
        credit: 0,
        description: 'نقل المصروفات من أرباح العام',

        if (balance > 0) {
          const { error: lineErr } = await s.from('journal_lines').insert({
            company_id: auth.companyId,
            journal_entry_id: jeId,
            account_id: acc.id,
            account_code: acc.code,
            account_name: acc.name,
            debit: 0,
            credit: balance,
            description: `إقفال ${acc.name}`,
        // ربح: مدين أرباح العام، دائن الأرباح المحتجزة
        const { error: profitErr } = await s.from('journal_lines').insert([
          {
            company_id: auth.companyId,
            journal_entry_id: jeId,
            account_id: currentYearEarningsAcc.id,
            account_code: '3300',
            account_name: 'أرباح العام',
            debit: netIncome,
            credit: 0,
            description: 'نقل صافي الربح',
          },
          {
            company_id: auth.companyId,
            journal_entry_id: jeId,
            account_id: retainedEarningsAcc.id,
            account_code: ACCOUNT_CODES.RETAINED_EARNINGS,
            account_name: 'أرباح محتجزة',
            debit: 0,
            credit: netIncome,
            description: 'صافي الربح إلى الأرباح المحتجزة',
        const loss = Math.abs(netIncome);
        const { error: lossErr } = await s.from('journal_lines').insert([
          {
            company_id: auth.companyId,
            journal_entry_id: jeId,
            account_id: retainedEarningsAcc.id,
            account_code: ACCOUNT_CODES.RETAINED_EARNINGS,
            account_name: 'أرباح محتجزة',
            debit: loss,
            credit: 0,
            description: 'صافي الخسارة من الأرباح المحتجزة',
          },
          {
            company_id: auth.companyId,
            journal_entry_id: jeId,
            account_id: currentYearEarningsAcc.id,
            account_code: '3300',
            account_name: 'أرباح العام',
            debit: 0,
            credit: loss,
            description: 'نقل صافي الخسارة',

src/app/api/fiscal/reversing/route.ts
+2
−2
import { success, error, requireApiAuth, handleApiError } from '@/lib/api-helpers';
import { getSupabase } from '@/lib/supabase-client';
import { getNextJournalNumber } from '@/lib/numbering';
import { insertJournalLines } from '@/lib/journal-utils';

const sb = () => getSupabase();

    const reverseLines = originalLines.map((line: any) => ({
      journal_entry_id: re.id,
      account_id: line.account_id,
      account_code: line.account_code,
      debit: parseFloat(line.credit) || 0,  // العكس: credit -> debit
      credit: parseFloat(line.debit) || 0,   // العكس: debit -> credit
      description: `عكس: ${line.description || ''}`,
    }));

    const { error: linesErr } = await s.from('journal_lines').insert(reverseLines);
    const { error: linesErr } = await insertJournalLines(auth.companyId, reverseLines);

    if (linesErr) {
      // التراجع عن إنشاء القيد العكسي

src/app/api/fixed-assets/[id]/route.ts
+73
import { NextRequest } from 'next/server';
import { success, error, notFound, requireApiAuth, requireModulePermission, handleApiError } from '@/lib/api-helpers';
import { getSupabase } from '@/lib/supabase-client';

const sb = () => getSupabase();

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const auth = await requireApiAuth(request);
    const { id } = await params;
    const { data, error: qErr } = await sb().from('fixed_assets')
      .select('*').eq('id', id).eq('company_id', auth.companyId).maybeSingle();
    if (qErr) throw qErr;
    if (!data) return notFound();
    const a = data as any;
    return success({
      ...a,
      net_book_value: (a.purchase_cost || 0) - (a.accumulated_depreciation || 0),
    });
  } catch (err) {
    return handleApiError(err);
  }
}

export async function PUT(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const auth = await requireModulePermission(request, 'fixed-assets', 'update');
    const { id } = await params;
    const s = sb();
    const body = await request.json();

    const { data: existing } = await s.from('fixed_assets')
      .select('id').eq('id', id).eq('company_id', auth.companyId).maybeSingle();
    if (!existing) return notFound();

    const updateData: any = {};
    for (const k of ['name', 'code', 'category', 'purchase_date', 'purchase_cost', 'useful_life_years', 'depreciation_rate', 'depreciation_method', 'location', 'notes']) {
      if (body[k] !== undefined) updateData[k] = body[k];
    }

    const { data: updated, error: updErr } = await s.from('fixed_assets')
      .update(updateData).eq('id', id).eq('company_id', auth.companyId).select('*').single();
    if (updErr) throw updErr;
    return success(updated);
  } catch (err) {
    return handleApiError(err);
  }
}

export async function DELETE(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const auth = await requireModulePermission(request, 'fixed-assets', 'delete');
    const { id } = await params;
    const s = sb();
    const { data: existing } = await s.from('fixed_assets')
      .select('id').eq('id', id).eq('company_id', auth.companyId).maybeSingle();
    if (!existing) return notFound();
    const { error: delErr } = await s.from('fixed_assets').delete().eq('id', id).eq('company_id', auth.companyId);
    if (delErr) throw delErr;
    return success({ deleted: true });
  } catch (err) {
    return handleApiError(err);
  }
}

src/app/api/fixed-assets/depreciate/route.ts
+5
−3
import { getSupabase } from '@/lib/supabase-client';
import { requireApiAuth, handleApiError, success } from '@/lib/api-helpers';
import { getNextJournalNumber } from '@/lib/numbering';
import { insertJournalLines } from '@/lib/journal-utils';

// @ts-ignore
const sb = () => getSupabase() as any;
        .select('id').eq('company_id', auth.companyId).eq('code', '1290').maybeSingle();

      if (depExpAcc && accumAcc) {
        await s.from('journal_lines').insert([
          { journal_entry_id: je.id, account_id: depExpAcc.id, account_code: '5260', debit: monthlyDepreciation, credit: 0, description: `إهلاك ${asset.code}` },
          { journal_entry_id: je.id, account_id: accumAcc.id, account_code: '1290', debit: 0, credit: monthlyDepreciation, description: `مجمع إهلاك ${asset.code}` },
        const { error: jlErr } = await insertJournalLines(auth.companyId, [
          { journal_entry_id: je.id, account_id: depExpAcc.id, debit: monthlyDepreciation, credit: 0, description: `إهلاك ${asset.code}` },
          { journal_entry_id: je.id, account_id: accumAcc.id, debit: 0, credit: monthlyDepreciation, description: `مجمع إهلاك ${asset.code}` },
        ]);
        if (jlErr) throw jlErr;
      }

      // Update asset

src/app/api/fixed-assets/route.ts
+15
−15
import { getNextJournalNumber } from '@/lib/numbering';
import { ACCOUNT_CODES } from '@/lib/constants';
import { createAutoAccount } from '@/lib/auto-account';
import { insertJournalLines } from '@/lib/journal-utils';

const sb = () => getSupabase();

        .select('id')
        .single();

      const jl: any[] = [
        { 
          journal_entry_id: je.id, 
          account_id: assetAccount?.id || assetAcc.id, 
          debit: purchase_cost, 
          credit: 0 
      const { error: jlErr } = await insertJournalLines(auth.companyId, [
        {
          journal_entry_id: je.id,
          account_id: assetAccount?.id || assetAcc.id,
          debit: purchase_cost,
          credit: 0,
        },
        { 
          journal_entry_id: je.id, 
          account_id: bankAcc.id, 
          debit: 0, 
          credit: purchase_cost 
        }
      ];

      await s.from('journal_lines').insert(jl);
        {
          journal_entry_id: je.id,
          account_id: bankAcc.id,
          debit: 0,
          credit: purchase_cost,
        },
      ]);
      if (jlErr) throw jlErr;
    }

    return success(asset, 201);

src/app/api/invoices/[id]/route.ts
+74
−4
    const { id } = await paramsPromise;
    const s = sb();

    // Fetch invoice with full client data
    const { data: invRes, error: invErr } = await s.from('invoices')
    // Schema-drift resilient: vat_* vs tax_*, optional deleted_at / contacts embed.
    let invRes: any = null;
    let invErr: any = null;
    const primary = await s.from('invoices')
      .select(`
        id, number, contact_id, project_id, date, due_date, subtotal,
        tax_rate, tax_amount, total, paid_amount, status, notes,
        vat_rate, vat_amount, tax_rate, tax_amount, total, paid_amount, status, notes,
        journal_entry_id, created_by, created_at,
        contacts(id, name, tax_number, address, phone, email, commercial_registration)
      `)
      .eq('id', id).eq('company_id', auth.companyId).is('deleted_at', null).maybeSingle();
      .eq('id', id).eq('company_id', auth.companyId).maybeSingle();
    invRes = primary.data; invErr = primary.error;
    if (invErr) {
      const fallback = await s.from('invoices')
        .select('id, number, contact_id, project_id, date, due_date, subtotal, total, paid_amount, status, notes, journal_entry_id, created_by, created_at')
        .eq('id', id).eq('company_id', auth.companyId).maybeSingle();
      invRes = fallback.data; invErr = fallback.error;
    }
    if (invErr || !invRes) return notFound();

    const { data: itemsRes } = await s.from('invoice_items')
  }
}

export async function PUT(
  request: NextRequest,
  { params: paramsPromise }: { params: Promise<{ id: string }> }
) {
  try {
    const auth = await requireModulePermission(request, 'invoices', 'update');
    const { id } = await paramsPromise;
    const s = sb();
    const body = await parseBody<any>(request);

    const { data: existing } = await s.from('invoices')
      .select('id, status, journal_entry_id, number')
      .eq('id', id).eq('company_id', auth.companyId).maybeSingle();
    if (!existing) return notFound();
    if ((existing as any).status === 'cancelled') return error('لا يمكن تعديل فاتورة ملغاة');

    const header: any = {};
    if (body.notes !== undefined) header.notes = body.notes;
    if (body.dueDate || body.due_date) header.due_date = body.dueDate || body.due_date;
    if (body.date) header.date = body.date;
    if (body.clientId || body.contact_id) header.contact_id = body.clientId || body.contact_id;
    if (body.projectId !== undefined || body.project_id !== undefined) {
      header.project_id = body.projectId ?? body.project_id ?? null;
    }

    // Financial rewrite only while unpaid (journal already posted otherwise).
    if ((existing as any).status === 'unpaid' && Array.isArray(body.items) && body.items.length > 0) {
      const round2 = (n: number) => Math.round((n + Number.EPSILON) * 100) / 100;
      const items = body.items.map((it: any) => {
        const qty = Number(it.quantity) || 0;
        const price = Number(it.unitPrice ?? it.unit_price) || 0;
        const disc = Number(it.discount) || 0;
        const gross = round2(qty * price);
        const discount = Math.min(round2(disc), gross);
        return { description: it.description, quantity: qty, unit_price: price, total: round2(gross - discount) };
      });
      const subtotal = round2(items.reduce((s: number, i: any) => s + i.total, 0));
      const vatRate = body.vatEnabled === false ? 0 : Number(body.vatRate ?? body.vat_rate ?? 0.15);
      const vatAmount = round2(subtotal * vatRate);
      header.subtotal = subtotal;
      header.vat_rate = vatRate;
      header.vat_amount = vatAmount;
      header.tax_rate = vatRate;
      header.tax_amount = vatAmount;
      header.total = round2(subtotal + vatAmount);

      await s.from('invoice_items').delete().eq('invoice_id', id);
      for (const item of items) {
        await s.from('invoice_items').insert({ company_id: auth.companyId, invoice_id: id, ...item });
      }
    }

    const { data: updated, error: updErr } = await s.from('invoices')
      .update(header).eq('id', id).eq('company_id', auth.companyId).select('*').single();
    if (updErr) throw updErr;
    return success(updated);
  } catch (err) {
    return handleApiError(err);
  }
}

export async function PATCH(
  request: NextRequest,
  { params: paramsPromise }: { params: Promise<{ id: string }> }

src/app/api/invoices/route.ts
+3
−2
      // 2. إدخال البنود (بقيم محسوبة خادمياً شاملة الخصم)
      for (const item of computedItems) {
        const { error: itemErr } = await s.from('invoice_items').insert({
          company_id: auth.companyId,
          invoice_id: invoiceId,
          description: item.description,
          quantity: item.quantity,
        if (voucherReceiptId) await s.from('voucher_receipts').delete().eq('id', voucherReceiptId);
        if (journalEntryId) {
          await s.from('journal_lines').delete().eq('journal_entry_id', journalEntryId);
          await s.from('journal_entries').delete().eq('id', journalEntryId);
          await s.from('journal_entries').delete().eq('id', journalEntryId).eq('company_id', auth.companyId);
        }
        if (invoiceId) {
          await s.from('invoice_items').delete().eq('invoice_id', invoiceId);
          await s.from('invoices').delete().eq('id', invoiceId);
          await s.from('invoices').delete().eq('id', invoiceId).eq('company_id', auth.companyId);
        }
      } catch (rollbackErr) {
        console.error('Rollback failed:', rollbackErr);

src/app/api/journal/[id]/route.ts
+83
−2
    const { id } = await paramsPromise;
    const s = sb();

    const { data: entryRes, error: entryErr } = await s.from('journal_entries')
      .select('id, company_id, number, date, type, description, reference, created_by, created_at')
    // Do NOT select a non-existent `reference` column — the schema uses
    // reference_type / reference_id. A failed GET left the edit form empty.
    let entryRes: any = null;
    let entryErr: any = null;
    const primary = await s.from('journal_entries')
      .select('id, company_id, number, date, type, description, reference_type, reference_id, created_by, created_at')
      .eq('id', id).eq('company_id', auth.companyId).maybeSingle();
    entryRes = primary.data;
    entryErr = primary.error;
    if (entryErr) {
      const fallback = await s.from('journal_entries')
        .select('id, company_id, number, date, type, description, created_by, created_at')
        .eq('id', id).eq('company_id', auth.companyId).maybeSingle();
      entryRes = fallback.data;
      entryErr = fallback.error;
    }
    if (entryErr || !entryRes) return notFound();

    const { data: linesRes } = await s.from('journal_lines')
  }
}

export async function PUT(
  request: NextRequest,
  { params: paramsPromise }: { params: Promise<{ id: string }> }
) {
  try {
    const auth = await requireModulePermission(request, 'journal', 'update');
    const { id } = await paramsPromise;
    const s = sb();
    const body = await request.json();

    const { data: existing } = await s.from('journal_entries')
      .select('id, number')
      .eq('id', id).eq('company_id', auth.companyId).maybeSingle();
    if (!existing) return notFound();

    for (const ref of REFERENCING_TABLES) {
      try {
        const { data: refs } = await s.from(ref.table)
          .select('id').eq('journal_entry_id', id).limit(1);
        if (refs && refs.length > 0) {
          return error(`لا يمكن تعديل قيد مرتبط بـ: ${ref.name}`);
        }
      } catch { /* table/column may not exist */ }
    }

    const { journalEntrySchema } = await import('@/lib/validation');
    const parsed = journalEntrySchema.safeParse(body);
    if (!parsed.success) return error(parsed.error.issues[0].message);

    const { date, type, description, lines } = parsed.data;

    const resolved: Array<{ account_id: string; debit: number; credit: number; description: string | null }> = [];
    for (const line of lines) {
      const { data: account } = await s.from('accounts')
        .select('id').eq('company_id', auth.companyId).eq('code', line.accountCode).maybeSingle();
      if (!account) return error(`الحساب برمز ${line.accountCode} غير موجود`);
      resolved.push({
        account_id: account.id,
        debit: line.debit,
        credit: line.credit,
        description: line.description || null,
      });
    }

    const { error: updErr } = await s.from('journal_entries')
      .update({ date, type, description: description || null })
      .eq('id', id).eq('company_id', auth.companyId);
    if (updErr) throw updErr;

    const { error: delErr } = await s.from('journal_lines').delete().eq('journal_entry_id', id);
    if (delErr) throw delErr;

    const { insertJournalLines } = await import('@/lib/journal-utils');
    const { error: linesErr } = await insertJournalLines(auth.companyId, resolved.map((l) => ({
      journal_entry_id: id,
      account_id: l.account_id,
      debit: l.debit,
      credit: l.credit,
      description: l.description,
    })));
    if (linesErr) throw linesErr;

    return success({ id, number: existing.number, date, type, description });
  } catch (err) {
    return handleApiError(err);
  }
}

export async function DELETE(
  request: NextRequest,
  { params: paramsPromise }: { params: Promise<{ id: string }> }

src/app/api/journal/route.ts
+11
−3
    try {
      // Resolve account IDs for all lines first
      const resolvedLines: Array<{accountId: string; accountCode: string; debit: number; credit: number; description: string | null; contactId: null; projectId: null}> = [];
      const { isHeaderAccount, HEADER_ACCOUNT_CODES } = await import('@/lib/account-resolve');
      for (const line of lines) {
        const { data: account } = await s.from('accounts')
          .select('id').eq('company_id', auth.companyId).eq('code', line.accountCode).maybeSingle();
          .select('id, code, is_header').eq('company_id', auth.companyId).eq('code', line.accountCode).maybeSingle();
        if (!account) throw new Error(`الحساب برمز ${line.accountCode} غير موجود`);
        if (isHeaderAccount(account) || HEADER_ACCOUNT_CODES.has(line.accountCode)) {
          throw new Error(`الحساب ${line.accountCode} حساب رئيسي ولا يُرحَّل عليه — اختر حساباً فرعياً`);
        }
        resolvedLines.push({
          accountId: account.id,
          accountCode: line.accountCode,
      if (rpcErr.message?.includes('الموازنة') || rpcErr.code === 'P0001') {
        return error(rpcErr.message || 'خطأ في الموازنة');
      }
      // RPC function not found - fall through to legacy logic below
      if (!rpcErr.message?.includes('function') && !rpcErr.message?.includes('does not exist') && !rpcErr.message?.includes('Could not find')) {
      // RPC function not found OR the live function still omits journal_lines.company_id
      // (23502 not-null) — fall through to the legacy path that writes company_id.
      const rpcMsg = rpcErr.message || '';
      const missingFn = rpcMsg.includes('function') || rpcMsg.includes('does not exist') || rpcMsg.includes('Could not find');
      const missingCompanyId = rpcErr.code === '23502' || /null value in column ["']?company_id["']?/i.test(rpcMsg) || /violates not-null constraint/i.test(rpcMsg);
      if (!missingFn && !missingCompanyId) {
        throw rpcAttempt;
      }
    }

src/app/api/payments/route.ts
+3
−1
            date: today, type: 'general',
            description: `سداد إلكتروني — فاتورة`, created_by: auth.userId,
          });
          await s.from('journal_lines').insert([
          const { insertJournalLines } = await import('@/lib/journal-utils');
          const { error: jlErr } = await insertJournalLines(auth.companyId, [
            { journal_entry_id: jeId, account_id: cash.id, debit: rec.amount, credit: 0, description: 'سداد إلكتروني' },
            { journal_entry_id: jeId, account_id: ar.id, debit: 0, credit: rec.amount, description: 'سداد فاتورة' },
          ]);
          if (jlErr) throw jlErr;

          await s.from('payment_records').update({ journal_entry_id: jeId }).eq('id', recordId);
        }

src/app/api/payroll/route.ts
+6
−2
import { getSupabase } from '@/lib/supabase-client';
import { getNextJournalNumber } from '@/lib/numbering';
import { ACCOUNT_CODES } from '@/lib/constants';
import { insertJournalLines } from '@/lib/journal-utils';

const sb = () => getSupabase();

      }
    }

    const jl: any[] = [];
    const jl: Array<{ journal_entry_id: string; account_id: string; debit: number; credit: number }> = [];
    if (salAcc) jl.push({ journal_entry_id: jeId, account_id: salAcc.id, debit: totalSalary, credit: 0 });
    if (accrAcc) jl.push({ journal_entry_id: jeId, account_id: accrAcc.id, debit: 0, credit: totalSalary - totalAdvance });
    if (advAcc && totalAdvance > 0) jl.push({ journal_entry_id: jeId, account_id: advAcc.id, debit: 0, credit: totalAdvance });
    if (jl.length > 0) await s.from('journal_lines').insert(jl);
    if (jl.length > 0) {
      const { error: jlErr } = await insertJournalLines(auth.companyId, jl);
      if (jlErr) throw jlErr;
    }

    return success(created, 201);
  } catch (err) { return handleApiError(err); }

src/app/api/pos/sales/route.ts
+6
−4
import { getSupabase } from '@/lib/supabase-client';
import { requireApiAuth, handleApiError, success, error, parseBody } from '@/lib/api-helpers';
import { getNextJournalNumber } from '@/lib/numbering';
import { insertJournalLines } from '@/lib/journal-utils';
const sb = () => getSupabase() as any;

export async function GET(req: NextRequest) {
      const { data: cashAcc } = await s.from('accounts').select('id').eq('company_id', auth.companyId).eq('code', '1110').maybeSingle();
      const { data: revAcc } = await s.from('accounts').select('id').eq('company_id', auth.companyId).eq('code', '4100').maybeSingle();

      if (cashAcc && revAcc) {
        await s.from('journal_lines').insert([
          { journal_entry_id: je.id, account_id: cashAcc.id, account_code: '1110', debit: total, credit: 0, description: `مبيعات POS ${number}` },
          { journal_entry_id: je.id, account_id: revAcc.id, account_code: '4100', debit: 0, credit: total, description: `إيراد POS ${number}` },
      if (cashAcc && revAcc && je) {
        const { error: jlErr } = await insertJournalLines(auth.companyId, [
          { journal_entry_id: je.id, account_id: cashAcc.id, debit: total, credit: 0, description: `مبيعات POS ${number}` },
          { journal_entry_id: je.id, account_id: revAcc.id, debit: 0, credit: total, description: `إيراد POS ${number}` },
        ]);
        if (jlErr) throw jlErr;
      }
    } catch (jeErr) {
      console.warn('POS journal creation failed:', jeErr);

src/app/api/progress-billing/route.ts
+8
−6
import { getSupabase } from '@/lib/supabase-client';
import { getNextJournalNumber } from '@/lib/numbering';
import { ACCOUNT_CODES } from '@/lib/constants';
import { insertJournalLines } from '@/lib/journal-utils';

const sb = () => getSupabase();

          .select('id').single();

        const totalDebit = gross_amount + taxAmount;
        const jl: any[] = [
          { company_id: auth.companyId, journal_entry_id: je.id, account_id: arAcc.id, account_code: ACCOUNT_CODES.ACCRUED_REVENUE, debit: totalDebit, credit: 0 },
          { company_id: auth.companyId, journal_entry_id: je.id, account_id: revAcc.id, account_code: ACCOUNT_CODES.CONTRACT_REVENUE, debit: 0, credit: netAmount },
        const jl = [
          { journal_entry_id: je.id, account_id: arAcc.id, debit: totalDebit, credit: 0 },
          { journal_entry_id: je.id, account_id: revAcc.id, debit: 0, credit: netAmount },
        ];
        if (retentionAmount > 0 && retAcc) jl.push({ company_id: auth.companyId, journal_entry_id: je.id, account_id: retAcc.id, account_code: ACCOUNT_CODES.RETENTIONS, debit: 0, credit: retentionAmount });
        if (taxAmount > 0 && vatAcc) jl.push({ company_id: auth.companyId, journal_entry_id: je.id, account_id: vatAcc.id, account_code: ACCOUNT_CODES.VAT_SALES, debit: 0, credit: taxAmount });
        await s.from('journal_lines').insert(jl);
        if (retentionAmount > 0 && retAcc) jl.push({ journal_entry_id: je.id, account_id: retAcc.id, debit: 0, credit: retentionAmount });
        if (taxAmount > 0 && vatAcc) jl.push({ journal_entry_id: je.id, account_id: vatAcc.id, debit: 0, credit: taxAmount });
        const { error: jlErr } = await insertJournalLines(auth.companyId, jl);
        if (jlErr) throw jlErr;
      }
    } catch (journalError) {
      console.warn('Failed to create journal entry for progress billing:', journalError);

src/app/api/projects/[id]/route.ts
+8
−2

    if (!project) return notFound();

    const { data: boq } = await s.from('boq_items')
      .select('*').eq('project_id', id).order('id');

    const p = project as any;
    return success({
      ...(project as any),
      client_name: (project as any).contacts?.name || null,
      ...p,
      client_id: p.client_id || p.contact_id || '',
      client_name: p.contacts?.name || null,
      boq_items: boq || [],
    });
  } catch (err) {
    return handleApiError(err);

src/app/api/projects/route.ts
+2
          for (const item of items) {
            const itemTotal = Number(item.total) || (Number(item.quantity) * Number(item.unit_price)) || 0;
            const { error: iiErr } = await s.from('invoice_items').insert({
              company_id: auth.companyId,
              invoice_id: invoiceId,
              description: item.description,
              quantity: Number(item.quantity) || 1,
          }
        } else {
          const { error: iiErr } = await s.from('invoice_items').insert({
            company_id: auth.companyId,
            invoice_id: invoiceId,
            description: `أعمال مشروع: ${mappedBody.name}`,
            quantity: 1,

src/app/api/purchases/invoices/route.ts
+1

      for (const item of computedItems) {
        const { error: itemErr } = await s.from('purchase_invoice_items').insert({
          company_id: auth.companyId,
          purchase_invoice_id: invoiceId,
          description: item.description,
          quantity: item.quantity,

src/app/api/purchases/orders/[id]/route.ts
+1
        const lineTotal = round2(item.quantity * item.unit_price);
        sum += lineTotal;
        const { error: itemErr } = await s.from('purchase_order_items').insert({
          company_id: auth.companyId,
          purchase_order_id: id,
          description: item.description,
          quantity: item.quantity,

src/app/api/purchases/orders/route.ts
+1
    try {
      for (const item of computedItems) {
        const { error: itemErr } = await s.from('purchase_order_items').insert({
          company_id: auth.companyId,
          purchase_order_id: po.id,
          description: item.description,
          quantity: item.quantity,

src/app/api/quotations/[id]/convert/route.ts
+1
    if (items.length > 0) {
      const invItems = items.map((item: any) => ({
        id: generateId(),
        company_id: auth.companyId,
        invoice_id: invoiceId,
        description: item.description,
        quantity: item.quantity,

src/app/api/quotations/[id]/route.ts
+1
      await s.from('quotation_items').delete().eq('quotation_id', id);
      for (const item of body.items) {
        await s.from('quotation_items').insert({
          company_id: auth.companyId,
          quotation_id: id,
          description: item.description,
          quantity: item.quantity,

src/app/api/quotations/route.ts
+1

    for (const item of items) {
      await s.from('quotation_items').insert({
        company_id: auth.companyId,
        quotation_id: result.id, description: item.description, quantity: item.quantity,
        unit_price: item.unit_price, total: item.quantity * item.unit_price,
      });

src/app/api/reports/aging/route.ts
+100
−105
import { NextRequest } from 'next/server';
import { success, error, requireApiAuth, handleApiError } from '@/lib/api-helpers';
import { getSupabase } from '@/lib/supabase-client';
import { ACCOUNT_CODES } from '@/lib/constants';

const sb = () => getSupabase();

function bucketFor(days: number) {
  if (days <= 30) return '0-30';
  if (days <= 60) return '31-60';
  if (days <= 90) return '61-90';
  return '90+';
}

export async function GET(req: NextRequest) {
  try {
    const auth = await requireApiAuth(req);
    const url = new URL(req.url);
    const type = url.searchParams.get('type') || 'ar';
    const asOf = url.searchParams.get('asOf') || new Date().toISOString().split('T')[0];
    const asOf = url.searchParams.get('asOf') || url.searchParams.get('to') || new Date().toISOString().split('T')[0];
    const s = sb();
    const asOfTime = new Date(asOf).getTime();

    if (type === 'ar') {
      const { data: account } = await s.from('accounts')
        .select('id')
        .eq('company_id', auth.companyId)
        .eq('code', ACCOUNT_CODES.ACCOUNTS_RECEIVABLE)
        .maybeSingle();

      if (!account) return success({ aging: [] });

      // Get contacts with balances
      const { data: jeIds } = await s.from('journal_entries')
        .select('id')
        .eq('company_id', auth.companyId);

      const jeIdList = (jeIds || []).map((je: any) => je.id);

      const { data: contacts } = await s.from('contacts')
        .select('id, name')
      const { data: invoices } = await s.from('invoices')
        .select('id, number, contact_id, date, due_date, total, paid_amount, status, contacts(name)')
        .eq('company_id', auth.companyId)
        .in('type', ['client', 'both'])
        .eq('is_active', true)
        .order('name');

      const aging: any[] = [];
      for (const c of (contacts || [])) {
        if (jeIdList.length === 0) continue;

        const { data: lines } = await s.from('journal_lines')
          .select('debit, credit')
          .eq('contact_id', c.id)
          .in('journal_entry_id', jeIdList);

        const totalDebit = (lines || []).reduce((sum: number, l: any) => sum + (parseFloat(l.debit) || 0), 0);
        const totalCredit = (lines || []).reduce((sum: number, l: any) => sum + (parseFloat(l.credit) || 0), 0);
        const balance = totalDebit - totalCredit;

        if (balance <= 0) continue;

        const { data: lastInvoice } = await s.from('invoices')
          .select('date')
          .eq('contact_id', c.id)
          .order('date', { ascending: false })
          .limit(1)
          .maybeSingle();

        const lastDate = lastInvoice?.date || asOf;
        const daysDiff = Math.floor((new Date(asOf).getTime() - new Date(lastDate).getTime()) / (1000 * 60 * 60 * 24));
        let bucket = '90+';
        if (daysDiff <= 30) bucket = '0-30';
        else if (daysDiff <= 60) bucket = '31-60';
        else if (daysDiff <= 90) bucket = '61-90';

        aging.push({ id: c.id, name: c.name, balance, last_invoice_date: lastDate, days_overdue: Math.max(0, daysDiff), bucket });
        .neq('status', 'cancelled')
        .neq('status', 'paid');

      const byContact = new Map<string, any>();
      for (const inv of invoices || []) {
        const total = parseFloat(inv.total) || 0;
        const paid = parseFloat(inv.paid_amount) || 0;
        const remaining = Math.max(0, total - paid);
        if (remaining <= 0) continue;
        const due = inv.due_date || inv.date || asOf;
        const days = Math.max(0, Math.floor((asOfTime - new Date(due).getTime()) / 86400000));
        const bucket = bucketFor(days);
        const key = inv.contact_id || inv.id;
        if (!byContact.has(key)) {
          byContact.set(key, {
            id: key,
            name: (inv as any).contacts?.name || 'عميل',
            balance: 0,
            last_invoice_date: inv.date,
            days_overdue: days,
            bucket,
            buckets: { '0-30': 0, '31-60': 0, '61-90': 0, '90+': 0 },
          });
        }
        const row = byContact.get(key);
        row.balance += remaining;
        row.buckets[bucket] += remaining;
        if (days > row.days_overdue) {
          row.days_overdue = days;
          row.bucket = bucket;
        }
        if (inv.date && (!row.last_invoice_date || inv.date > row.last_invoice_date)) {
          row.last_invoice_date = inv.date;
        }
      }

      return success({ aging, type: 'ar', asOf });
      const aging = [...byContact.values()].sort((a, b) => b.balance - a.balance);
      const totals = aging.reduce((acc, r) => {
        acc.balance += r.balance;
        acc['0-30'] += r.buckets['0-30'];
        acc['31-60'] += r.buckets['31-60'];
        acc['61-90'] += r.buckets['61-90'];
        acc['90+'] += r.buckets['90+'];
        return acc;
      }, { balance: 0, '0-30': 0, '31-60': 0, '61-90': 0, '90+': 0 });

      return success({ aging, totals, type: 'ar', asOf });
    }

    if (type === 'ap') {
      const { data: account } = await s.from('accounts')
        .select('id')
      const { data: invoices } = await s.from('purchase_invoices')
        .select('id, number, supplier_id, date, due_date, total, paid_amount, status, contacts:supplier_id(name)')
        .eq('company_id', auth.companyId)
        .eq('code', ACCOUNT_CODES.ACCOUNTS_PAYABLE)
        .maybeSingle();

      if (!account) return success({ aging: [] });

      const { data: jeIds } = await s.from('journal_entries')
        .select('id')
        .eq('company_id', auth.companyId);

      const jeIdList = (jeIds || []).map((je: any) => je.id);

      const { data: contacts } = await s.from('contacts')
        .select('id, name')
        .eq('company_id', auth.companyId)
        .in('type', ['supplier', 'both'])
        .eq('is_active', true)
        .order('name');

      const aging: any[] = [];
      for (const c of (contacts || [])) {
        if (jeIdList.length === 0) continue;

        const { data: lines } = await s.from('journal_lines')
          .select('debit, credit')
          .eq('contact_id', c.id)
          .in('journal_entry_id', jeIdList);

        const totalDebit = (lines || []).reduce((sum: number, l: any) => sum + (parseFloat(l.debit) || 0), 0);
        const totalCredit = (lines || []).reduce((sum: number, l: any) => sum + (parseFloat(l.credit) || 0), 0);
        const balance = totalCredit - totalDebit;

        if (balance <= 0) continue;

        const { data: lastInvoice } = await s.from('purchase_invoices')
          .select('date')
          .eq('supplier_id', c.id)
          .order('date', { ascending: false })
          .limit(1)
          .maybeSingle();

        const lastDate = lastInvoice?.date || asOf;
        const daysDiff = Math.floor((new Date(asOf).getTime() - new Date(lastDate).getTime()) / (1000 * 60 * 60 * 24));
        let bucket = '90+';
        if (daysDiff <= 30) bucket = '0-30';
        else if (daysDiff <= 60) bucket = '31-60';
        else if (daysDiff <= 90) bucket = '61-90';

        aging.push({ id: c.id, name: c.name, balance, last_invoice_date: lastDate, days_overdue: Math.max(0, daysDiff), bucket });
        .neq('status', 'cancelled')
        .neq('status', 'paid');

      const byContact = new Map<string, any>();
      for (const inv of invoices || []) {
        const total = parseFloat(inv.total) || 0;
        const paid = parseFloat(inv.paid_amount) || 0;
        const remaining = Math.max(0, total - paid);
        if (remaining <= 0) continue;
        const due = inv.due_date || inv.date || asOf;
        const days = Math.max(0, Math.floor((asOfTime - new Date(due).getTime()) / 86400000));
        const bucket = bucketFor(days);
        const key = inv.supplier_id || inv.id;
        if (!byContact.has(key)) {
          byContact.set(key, {
            id: key,
            name: (inv as any).contacts?.name || 'مورد',
            balance: 0,
            last_invoice_date: inv.date,
            days_overdue: days,
            bucket,
            buckets: { '0-30': 0, '31-60': 0, '61-90': 0, '90+': 0 },
          });
        }
        const row = byContact.get(key);
        row.balance += remaining;
        row.buckets[bucket] += remaining;
        if (days > row.days_overdue) {
          row.days_overdue = days;
          row.bucket = bucket;
        }
      }

      return success({ aging, type: 'ap', asOf });
      const aging = [...byContact.values()].sort((a, b) => b.balance - a.balance);
      const totals = aging.reduce((acc, r) => {
        acc.balance += r.balance;
        acc['0-30'] += r.buckets['0-30'];
        acc['31-60'] += r.buckets['31-60'];
        acc['61-90'] += r.buckets['61-90'];
        acc['90+'] += r.buckets['90+'];
        return acc;
      }, { balance: 0, '0-30': 0, '31-60': 0, '61-90': 0, '90+': 0 });

      return success({ aging, totals, type: 'ap', asOf });
    }

    return error('Invalid aging type. Use "ar" or "ap"');

src/app/api/reports/cash-flow/route.ts
+2
−7
    const from = url.searchParams.get('from');
    const to = url.searchParams.get('to');

    // Get cash and bank accounts (1110, 1120)
    const { data: cashAccounts } = await s.from('accounts')
      .select('id, code, name')
      .eq('company_id', auth.companyId)
      .in('code', ['1110', '1120']);

    const cashAccountIds = (cashAccounts || []).map((a: any) => a.id);
    const { listCashBankAccountIds } = await import('@/lib/account-resolve');
    const cashAccountIds = await listCashBankAccountIds(s, auth.companyId);

    if (cashAccountIds.length === 0) {
      return success({

src/app/api/reports/financial/route.ts
+4
−2
 */
export async function GET(req: NextRequest) {
  try {
    const auth = await requireApiAuth(req);
    const auth = await requireModulePermission(req, 'reports', 'read');
    const s = sb();
    const url = new URL(req.url);
    const type = url.searchParams.get('type') || 'trial_balance';
    let linesData: any[] = [];
    if (jeIds.length > 0) {
      const { data: lines } = await s.from('journal_lines')
        .select('account_id, debit, credit').in('journal_entry_id', jeIds);
        .select('account_id, debit, credit')
        .eq('company_id', auth.companyId)
        .in('journal_entry_id', jeIds);
      linesData = lines || [];
    }


src/app/api/reports/general-ledger/route.ts
+1
−1

    // Get journal entries for date range
    let entryQuery = s.from('journal_entries')
      .select('id, number, date, description, reference, type')
      .select('id, number, date, description, reference_type, reference_id, type')
      .eq('company_id', auth.companyId)
      .is('deleted_at', null)
      .order('date', { ascending: true })

src/app/api/reports/operational/route.ts
+15
−11
    const type = req.nextUrl.searchParams.get('type') || 'project-costs';
    const s = sb();

    if (type === 'project-costs' && projectId) {
    if (type === 'project-costs') {
      // Material costs
      const { data: materials } = await s.from('inventory_transactions')
      let materialsQ = s.from('inventory_transactions')
        .select('total_value')
        .eq('company_id', auth.companyId)
        .eq('project_id', projectId)
        .eq('type', 'issue');
      if (projectId) materialsQ = materialsQ.eq('project_id', projectId);
      const { data: materials } = await materialsQ;

      const materialTotal = (materials || []).reduce((sum: number, m: any) => sum + (parseFloat(m.total_value) || 0), 0);

      // Worker costs
      const { data: workers } = await s.from('daily_worker_records')
      let workersQ = s.from('daily_worker_records')
        .select('wage, days')
        .eq('company_id', auth.companyId)
        .eq('project_id', projectId);
        .eq('company_id', auth.companyId);
      if (projectId) workersQ = workersQ.eq('project_id', projectId);
      const { data: workers } = await workersQ;

      const workerTotal = (workers || []).reduce((sum: number, w: any) => sum + ((parseFloat(w.wage) || 0) * (parseFloat(w.days) || 0)), 0);

      // Purchase costs
      const { data: purchases } = await s.from('purchase_invoices')
      let purchasesQ = s.from('purchase_invoices')
        .select('total')
        .eq('company_id', auth.companyId)
        .eq('project_id', projectId)
        .neq('status', 'cancelled');
      if (projectId) purchasesQ = purchasesQ.eq('project_id', projectId);
      const { data: purchases } = await purchasesQ;

      const purchaseTotal = (purchases || []).reduce((sum: number, p: any) => sum + (parseFloat(p.total) || 0), 0);

      // Subcontractor costs
      const { data: contracts } = await s.from('subcontractor_contracts')
      let contractsQ = s.from('subcontractor_contracts')
        .select('id')
        .eq('company_id', auth.companyId)
        .eq('project_id', projectId);
        .eq('company_id', auth.companyId);
      if (projectId) contractsQ = contractsQ.eq('project_id', projectId);
      const { data: contracts } = await contractsQ;

      const contractIds = (contracts || []).map((c: any) => c.id);
      let subTotal = 0;

src/app/api/reports/profitability/route.ts
+62
−26
  try {
    const auth = await requireApiAuth(req);
    const s = sb();
    const url = new URL(req.url);
    const from = url.searchParams.get('from');
    const to = url.searchParams.get('to');

    const { data: projects } = await s.from('projects')
      .select('id, name, contract_value, client_id, status, contacts!client_id(name)')
      .eq('company_id', auth.companyId)
      .order('name');

    const result: any[] = [];
    for (const project of (projects || [])) {
      // Get project costs from journal_lines linked via project_id in journal_entries
      const { data: jeIds } = await s.from('journal_entries')
        .select('id')
        .eq('company_id', auth.companyId)
        .or(`project_id.eq.${project.id}`);
    const { data: expenseAccounts } = await s.from('accounts')
      .select('id')
      .eq('company_id', auth.companyId)
      .eq('type', 'expense');
    const expAccountIds = new Set((expenseAccounts || []).map((a: any) => a.id));

      const jeIdList = (jeIds || []).map((je: any) => je.id);
    const { data: revenueAccounts } = await s.from('accounts')
      .select('id')
      .eq('company_id', auth.companyId)
      .eq('type', 'revenue');
    const revAccountIds = new Set((revenueAccounts || []).map((a: any) => a.id));

      let totalCosts = 0;
      if (jeIdList.length > 0) {
        // Get expense account IDs
        const { data: expenseAccounts } = await s.from('accounts')
          .select('id')
          .eq('company_id', auth.companyId)
          .eq('type', 'expense');
    let invQuery = s.from('invoices')
      .select('id, project_id, total, tax_amount, vat_amount, status')
      .eq('company_id', auth.companyId)
      .neq('status', 'cancelled');
    if (from) invQuery = invQuery.gte('date', from);
    if (to) invQuery = invQuery.lte('date', to);
    const { data: invoices } = await invQuery;

        const expAccountIds = (expenseAccounts || []).map((a: any) => a.id);
    const billedByProject = new Map<string, number>();
    for (const inv of invoices || []) {
      if (!inv.project_id) continue;
      const total = parseFloat(inv.total) || 0;
      billedByProject.set(inv.project_id, (billedByProject.get(inv.project_id) || 0) + total);
    }

        if (expAccountIds.length > 0) {
          const { data: lines } = await s.from('journal_lines')
            .select('debit')
            .in('account_id', expAccountIds)
            .in('journal_entry_id', jeIdList);
    let linesQuery = s.from('journal_lines')
      .select('project_id, account_id, debit, credit')
      .eq('company_id', auth.companyId)
      .not('project_id', 'is', null);
    const { data: lines } = await linesQuery;

          totalCosts = (lines || []).reduce((sum: number, l: any) => sum + (parseFloat(l.debit) || 0), 0);
        }
    const costByProject = new Map<string, number>();
    const earnedByProject = new Map<string, number>();
    for (const l of lines || []) {
      if (!l.project_id) continue;
      const debit = parseFloat(l.debit) || 0;
      const credit = parseFloat(l.credit) || 0;
      if (expAccountIds.has(l.account_id)) {
        costByProject.set(l.project_id, (costByProject.get(l.project_id) || 0) + debit - credit);
      }
      if (revAccountIds.has(l.account_id)) {
        earnedByProject.set(l.project_id, (earnedByProject.get(l.project_id) || 0) + credit - debit);
      }
    }

    const result: any[] = [];
    for (const project of (projects || [])) {
      const contractValue = parseFloat(project.contract_value) || 0;
      const profit = contractValue - totalCosts;
      const profitMargin = contractValue > 0 ? (profit / contractValue) * 100 : 0;
      const billed = billedByProject.get(project.id) || 0;
      const journalRevenue = earnedByProject.get(project.id) || 0;
      const revenue = billed > 0 ? billed : journalRevenue;
      const totalCosts = costByProject.get(project.id) || 0;
      const profit = revenue - totalCosts;
      const profitMargin = revenue > 0 ? (profit / revenue) * 100 : 0;

      result.push({
        ...project,
        client_name: (project as Record<string, any>).contacts?.name || null,
        contract_value: contractValue,
        billed_amount: billed,
        revenue,
        total_costs: totalCosts,
        profit,
        profit_margin: profitMargin,
      });
    }

    return success({ projects: result });
    const totals = result.reduce((acc, p) => {
      acc.contract_value += p.contract_value;
      acc.revenue += p.revenue;
      acc.total_costs += p.total_costs;
      acc.profit += p.profit;
      return acc;
    }, { contract_value: 0, revenue: 0, total_costs: 0, profit: 0 });

    return success({ projects: result, totals });
  } catch (err) {
    return handleApiError(err);
  }

src/app/api/reports/vat/route.ts
+1
−1

    // Also get from invoices directly for more accurate VAT
    let invoiceQuery = s.from('invoices')
      .select('id, number, date, subtotal, vat_amount, total')
      .select('id, number, date, subtotal, vat_amount, tax_amount, total')
      .eq('company_id', auth.companyId)
      .neq('status', 'cancelled')
      .is('deleted_at', null);

src/app/api/subcontractors/certificates/route.ts
+4
−2
import { getSupabase } from '@/lib/supabase-client';
import { ACCOUNT_CODES } from '@/lib/constants';
import { getNextJournalNumber } from '@/lib/numbering';
import { insertJournalLines } from '@/lib/journal-utils';

const sb = () => getSupabase();


      if (jeErr) throw jeErr;

      const lines: any[] = [
      const lines = [
        { journal_entry_id: je.id, account_id: costAccount.id, debit: gross_amount, credit: 0 },
        { journal_entry_id: je.id, account_id: apAccount.id, debit: 0, credit: netAmount },
      ];
        lines.push({ journal_entry_id: je.id, account_id: retentionAccount.id, debit: 0, credit: retentionAmount });
      }

      await s.from('journal_lines').insert(lines);
      const { error: jlErr } = await insertJournalLines(auth.companyId, lines);
      if (jlErr) throw jlErr;
    }

    return success(cert, 201);

src/app/api/subcontractors/payments/route.ts
+4
−2
import { getSupabase } from '@/lib/supabase-client';
import { ACCOUNT_CODES } from '@/lib/constants';
import { getNextJournalNumber } from '@/lib/numbering';
import { insertJournalLines } from '@/lib/journal-utils';

const sb = () => getSupabase();


      if (jeErr) throw jeErr;

      await s.from('journal_lines').insert([
      const { error: jlErr } = await insertJournalLines(auth.companyId, [
        { journal_entry_id: je.id, account_id: apAccount.id, debit: amount, credit: 0 },
        { journal_entry_id: je.id, account_id: bankAccount.account_id, debit: 0, credit: amount },
        { journal_entry_id: je.id, account_id: bankAccount.account_id!, debit: 0, credit: amount },
      ]);
      if (jlErr) throw jlErr;
    }

    return success(payment, 201);

src/app/api/visitors/route.ts
+25
−4
import { NextRequest } from 'next/server';
import { success } from '@/lib/api-helpers';
import { success, error } from '@/lib/api-helpers';
import { getSupabase } from '@/lib/supabase-client';

const sb = () => getSupabase();

const visitorHits = new Map<string, { n: number; reset: number }>();

function allowVisitorHit(ip: string, max = 30, windowMs = 60 * 60 * 1000): boolean {
  const now = Date.now();
  const rec = visitorHits.get(ip);
  if (!rec || now > rec.reset) {
    visitorHits.set(ip, { n: 1, reset: now + windowMs });
    return true;
  }
  rec.n += 1;
  return rec.n <= max;
}

export async function POST(request: NextRequest) {
  try {
    const ip = request.headers.get('x-forwarded-for')?.split(',')[0]?.trim() ||
               request.headers.get('x-real-ip') || 'unknown';
    const ip = request.headers.get('x-forwarded-for')?.split(',')[0]?.trim()
      || request.headers.get('x-real-ip') || 'unknown';
    if (!allowVisitorHit(ip)) {
      return error('تم تجاوز حد تسجيل الزيارات', 429);
    }
    const ua = request.headers.get('user-agent') || '';
    const { path } = await request.json().catch(() => ({ path: '/' }));
    const s = sb();
      .gte('date', sevenDaysAgo)
      .order('date');

    const today = todayStats || { visits: 0, unique_visitors: 0 };
    return success({
      today: todayStats || { visits: 0, unique_visitors: 0 },
      today,
      visits: today.visits || 0,
      unique_visitors: today.unique_visitors || 0,
      totalVisits: totalVisits || 0,
      weekly: weekly || [],
    });
  } catch {
    return success({
      today: { visits: 0, unique_visitors: 0 },
      visits: 0,
      unique_visitors: 0,
      totalVisits: 0,
      weekly: [],
    });

src/components/layout/Sidebar.tsx
+1
−1
      { id: 'invoices', label: 'الفواتير' },
      { id: 'vouchers/receipt', label: 'سندات قبض' },
      { id: 'vouchers/disbursement', label: 'سندات صرف' },
      { id: 'cash', label: 'النقدية' },
      { id: 'cash', label: 'حركة النقدية' },
      { id: 'bank-reconciliation', label: 'تسوية البنوك' },
    ],
  },

src/components/ui/ActionButtons.tsx
+11
−6
import { Button } from './Button';
import { Modal } from './Modal';
import { Badge } from './Badge';
import { RecordViewModal } from './RecordViewModal';

interface ActionButtonsProps {
  item: any;
  showStatus = false 
}: ActionButtonsProps) {
  const [showDeleteModal, setShowDeleteModal] = useState(false);
  const [showViewModal, setShowViewModal] = useState(false);
  const [deleting, setDeleting] = useState(false);

  const handleDelete = async () => {
    <>
      <div className="flex items-center gap-2">
        {showStatus && status && statusBadge(status)}
        
        {onView && (
          <Button variant="ghost" size="sm" onClick={() => onView(item)} title="عرض">
            <Eye size={16} />
          </Button>
        )}

        <Button
          variant="ghost"
          size="sm"
          onClick={() => (onView ? onView(item) : setShowViewModal(true))}
          title="عرض"
        >
          <Eye size={16} />
        </Button>
        
        {onEdit && (
          <Button variant="ghost" size="sm" onClick={() => onEdit(item)} title="تعديل">

src/components/ui/RecordViewModal.tsx
+110
'use client';

import type { ReactNode } from 'react';
import { Modal } from './Modal';
import { Button } from './Button';
import { formatCurrency, formatDate } from '@/lib/utils';

const HIDDEN = new Set([
  'id', 'company_id', 'created_by', 'updated_at', 'deleted_at',
  'contacts', 'accounts', 'projects', 'employees', 'invoices',
  'journal_entry_id', 'password', 'password_hash', 'token',
]);

const LABELS: Record<string, string> = {
  number: 'الرقم',
  date: 'التاريخ',
  due_date: 'تاريخ الاستحقاق',
  name: 'الاسم',
  description: 'البيان',
  notes: 'ملاحظات',
  status: 'الحالة',
  type: 'النوع',
  total: 'الإجمالي',
  subtotal: 'المجموع الفرعي',
  vat_amount: 'الضريبة',
  tax_amount: 'الضريبة',
  vat_rate: 'نسبة الضريبة',
  tax_rate: 'نسبة الضريبة',
  paid_amount: 'المدفوع',
  amount: 'المبلغ',
  debit: 'مدين',
  credit: 'دائن',
  client_name: 'العميل',
  contact_name: 'العميل',
  supplier_name: 'المورد',
  project_name: 'المشروع',
  account_code: 'رمز الحساب',
  account_name: 'الحساب',
  phone: 'الهاتف',
  email: 'البريد',
  address: 'العنوان',
  location: 'الموقع',
  start_date: 'تاريخ البدء',
  end_date: 'تاريخ الانتهاء',
  contract_value: 'قيمة العقد',
  valid_until: 'صالح حتى',
  created_at: 'تاريخ الإنشاء',
};

function labelOf(key: string) {
  return LABELS[key] || key.replace(/_/g, ' ');
}

function formatValue(key: string, value: any): string {
  if (value == null || value === '') return '—';
  if (typeof value === 'boolean') return value ? 'نعم' : 'لا';
  if (typeof value === 'object') return '';
  const s = String(value);
  if (/date|until|created_at|_at$/i.test(key) && /\d{4}-\d{2}-\d{2}/.test(s)) {
    return formatDate(s.slice(0, 10));
  }
  if (/amount|total|debit|credit|balance|price|value|subtotal|vat|tax|paid/i.test(key) && !Number.isNaN(Number(value))) {
    return formatCurrency(Number(value));
  }
  return s;
}

export function RecordViewModal({
  isOpen,
  onClose,
  title,
  record,
  extra,
}: {
  isOpen: boolean;
  onClose: () => void;
  title?: string;
  record: Record<string, any> | null;
  extra?: ReactNode;
}) {
  if (!record) return null;
  const entries = Object.entries(record).filter(([k, v]) => {
    if (HIDDEN.has(k)) return false;
    if (v == null || v === '') return false;
    if (typeof v === 'object') return false;
    return true;
  });

  return (
    <Modal
      isOpen={isOpen}
      onClose={onClose}
      title={title || 'عرض السجل'}
      size="lg"
      footer={<Button variant="ghost" onClick={onClose}>إغلاق</Button>}
    >
      <div className="space-y-4">
        <dl className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          {entries.map(([k, v]) => (
            <div key={k} className="rounded-lg bg-bg-secondary/50 border border-border px-3 py-2">
              <dt className="text-xs text-text-muted mb-0.5">{labelOf(k)}</dt>
              <dd className="text-sm font-medium text-text-primary break-words">{formatValue(k, v)}</dd>
            </div>
          ))}
        </dl>
        {extra}
      </div>
    </Modal>
  );
}

src/lib/account-resolve.ts
+103
/**
 * تمييز الحسابات الرئيسية (غير قابلة للترحيل) وحل حسابات النقدية/البنوك الفعلية.
 * البرامج المحاسبية لا ترحّل على المجموعات (الأصول، الخصوم، البنوك كمجموعة).
 */

export const HEADER_ACCOUNT_CODES = new Set([
  '1000', // الأصول
  '1100', // الأصول المتداولة
  '1200', // الأصول الثابتة
  '2000', // الخصوم
  '2100', // الخصوم المتداولة
  '2200', // الخصوم غير المتداولة
  '3000', // حقوق الملكية
  '4000', // الإيرادات
  '5000', // المصروفات
  '5100', // تكلفة مباشرة
  '5200', // مصروفات تشغيلية
]);

export function isHeaderAccount(acc: {
  code?: string | null;
  is_header?: boolean | null;
  children?: unknown[] | null;
}): boolean {
  if (acc?.is_header === true) return true;
  if (Array.isArray(acc?.children) && acc.children.length > 0) return true;
  if (acc?.code && HEADER_ACCOUNT_CODES.has(String(acc.code))) return true;
  return false;
}

export function isCashOrBankCode(code: string | null | undefined): boolean {
  if (!code) return false;
  return (
    code === '1110' ||
    code === '1120' ||
    code.startsWith('1110-') ||
    code.startsWith('1120-')
  );
}

/**
 * حساب الدفع الافتراضي: خزينة/بنك مسجّل في banks_safes ثم 1110 ثم 1120.
 */
export async function resolvePaymentAccountId(
  supabase: any,
  companyId: string,
  preferredBankSafeId?: string | null,
): Promise<string | null> {
  if (preferredBankSafeId) {
    const { data } = await supabase
      .from('banks_safes')
      .select('account_id')
      .eq('id', preferredBankSafeId)
      .eq('company_id', companyId)
      .maybeSingle();
    if (data?.account_id) return data.account_id;
  }

  const { data: safes } = await supabase
    .from('banks_safes')
    .select('account_id, type')
    .eq('company_id', companyId)
    .eq('is_active', true)
    .order('type'); // safe قبل bank أبجدياً؟ type: bank < safe — نفضّل الخزينة

  const rows = (safes || []).filter((r: any) => r.account_id);
  const cash = rows.find((r: any) => r.type === 'safe');
  if (cash?.account_id) return cash.account_id;
  if (rows[0]?.account_id) return rows[0].account_id;

  for (const code of ['1110', '1120']) {
    const { data: acc } = await supabase
      .from('accounts')
      .select('id')
      .eq('company_id', companyId)
      .eq('code', code)
      .maybeSingle();
    if (acc?.id) return acc.id;
  }
  return null;
}

export async function listCashBankAccountIds(
  supabase: any,
  companyId: string,
): Promise<string[]> {
  const ids = new Set<string>();
  const { data: accounts } = await supabase
    .from('accounts')
    .select('id, code')
    .eq('company_id', companyId);
  for (const a of accounts || []) {
    if (isCashOrBankCode(a.code)) ids.add(a.id);
  }
  const { data: safes } = await supabase
    .from('banks_safes')
    .select('account_id')
    .eq('company_id', companyId);
  for (const s of safes || []) {
    if (s.account_id) ids.add(s.account_id);
  }
  return [...ids];
}

src/lib/constants.ts
+3
−3

export const PROJECT_EXPENSE_CODES: Record<string, string> = {
  materials: '5110',
  labor: '5210',
  labor: '5120',
  subcontractor: '5130',
  equipment: '5120',
  other: '5100',
  equipment: '5140',
  other: '5400',
};

export type AccountCode = (typeof ACCOUNT_CODES)[keyof typeof ACCOUNT_CODES];

src/lib/default-accounts.ts
+104
−31
/**
 * Default Chart of Accounts Template
 * Standard accounts that every company needs, pre-created on registration
 * Based on Saudi accounting standards and suitable for all industries
 * شجرة حسابات سعودية/IFRS للشركات والمقاولات — الحسابات الرئيسية غير قابلة للترحيل
 * والحسابات الفرعية هي حسابات ترحيل حقيقية ترتبط بالوحدات (بنوك، خزائن، ضريبة، رواتب…).
 */

import { HEADER_ACCOUNT_CODES } from '@/lib/account-resolve';

export interface DefaultAccount {
  code: string;
  name: string;
  nameEn: string;
  type: 'asset' | 'liability' | 'equity' | 'revenue' | 'expense';
  parentCode?: string;
  isHeader?: boolean;
}

export const DEFAULT_CHART_OF_ACCOUNTS: DefaultAccount[] = [
  // الأصول - Assets 1000-1999
  { code: '1000', name: 'الأصول', nameEn: 'Assets', type: 'asset' },
  { code: '1100', name: 'الأصول المتداولة', nameEn: 'Current Assets', type: 'asset', parentCode: '1000' },
  { code: '1000', name: 'الأصول', nameEn: 'Assets', type: 'asset', isHeader: true },
  { code: '1100', name: 'الأصول المتداولة', nameEn: 'Current Assets', type: 'asset', parentCode: '1000', isHeader: true },
  { code: '1110', name: 'الخزينة', nameEn: 'Cash on Hand', type: 'asset', parentCode: '1100' },
  { code: '1120', name: 'البنوك', nameEn: 'Banks', type: 'asset', parentCode: '1100' },
  { code: '1130', name: 'العملاء - ذمم مدينة', nameEn: 'Accounts Receivable - Clients', type: 'asset', parentCode: '1100' },
  { code: '1135', name: 'إيرادات مستحقة', nameEn: 'Accrued Revenue', type: 'asset', parentCode: '1100' },
  { code: '1140', name: 'مصروفات مدفوعة مقدماً', nameEn: 'Prepaid Expenses', type: 'asset', parentCode: '1100' },
  { code: '1150', name: 'عهد الموظفين', nameEn: 'Employee Custodies', type: 'asset', parentCode: '1100' },
  { code: '1160', name: 'سلف الموظفين', nameEn: 'Employee Advances', type: 'asset', parentCode: '1100' },
  { code: '1170', name: 'المخزون', nameEn: 'Inventory', type: 'asset', parentCode: '1100' },
  { code: '1180', name: 'ضريبة القيمة المضافة - مشتريات', nameEn: 'VAT - Purchases', type: 'asset', parentCode: '1100' },
  { code: '1190', name: 'دفعات مقدمة لموردين', nameEn: 'Advance to Suppliers', type: 'asset', parentCode: '1100' },
  
  { code: '1200', name: 'الأصول الثابتة', nameEn: 'Fixed Assets', type: 'asset', parentCode: '1000' },
  { code: '1191', name: 'دفعات مقدمة لمقاولي باطن', nameEn: 'Subcontractor Advances', type: 'asset', parentCode: '1100' },

  { code: '1200', name: 'الأصول الثابتة', nameEn: 'Fixed Assets', type: 'asset', parentCode: '1000', isHeader: true },
  { code: '1210', name: 'الأراضي', nameEn: 'Lands', type: 'asset', parentCode: '1200' },
  { code: '1220', name: 'المباني', nameEn: 'Buildings', type: 'asset', parentCode: '1200' },
  { code: '1230', name: 'الآلات والمعدات', nameEn: 'Machinery & Equipment', type: 'asset', parentCode: '1200' },
  { code: '1240', name: 'السيارات', nameEn: 'Vehicles', type: 'asset', parentCode: '1200' },
  { code: '1250', name: 'الأثاث والمفروشات', nameEn: 'Furniture', type: 'asset', parentCode: '1200' },
  { code: '1260', name: 'أجهزة الحاسب', nameEn: 'Computers', type: 'asset', parentCode: '1200' },
  { code: '1290', name: 'مجمع إهلاك الأصول الثابتة', nameEn: 'Accumulated Depreciation', type: 'asset', parentCode: '1000' },
  { code: '1290', name: 'مجمع إهلاك الأصول الثابتة', nameEn: 'Accumulated Depreciation', type: 'asset', parentCode: '1200' },

  // الخصوم - Liabilities 2000-2999
  { code: '2000', name: 'الخصوم', nameEn: 'Liabilities', type: 'liability' },
  { code: '2100', name: 'الخصوم المتداولة', nameEn: 'Current Liabilities', type: 'liability', parentCode: '2000' },
  { code: '2000', name: 'الخصوم', nameEn: 'Liabilities', type: 'liability', isHeader: true },
  { code: '2100', name: 'الخصوم المتداولة', nameEn: 'Current Liabilities', type: 'liability', parentCode: '2000', isHeader: true },
  { code: '2110', name: 'الموردون - ذمم دائنة', nameEn: 'Accounts Payable - Suppliers', type: 'liability', parentCode: '2100' },
  { code: '2120', name: 'ضريبة القيمة المضافة - مبيعات', nameEn: 'VAT - Sales', type: 'liability', parentCode: '2100' },
  { code: '2130', name: 'القروض قصيرة الأجل', nameEn: 'Short-term Loans', type: 'liability', parentCode: '2100' },
  { code: '2140', name: 'رواتب مستحقة', nameEn: 'Accrued Salaries', type: 'liability', parentCode: '2100' },
  { code: '2145', name: 'مصروفات مستحقة', nameEn: 'Accrued Expenses', type: 'liability', parentCode: '2100' },
  { code: '2150', name: 'مقاولو باطن - مستحق', nameEn: 'Subcontractors Payable', type: 'liability', parentCode: '2100' },
  { code: '2160', name: 'محجوزات ضمان', nameEn: 'Retentions Payable', type: 'liability', parentCode: '2100' },
  { code: '2170', name: 'عمالة يومية مستحقة', nameEn: 'Daily Workers Payable', type: 'liability', parentCode: '2100' },
  { code: '2180', name: 'دفعات مقدمة من عملاء', nameEn: 'Advances from Clients', type: 'liability', parentCode: '2100' },
  
  { code: '2200', name: 'الخصوم غير المتداولة', nameEn: 'Non-current Liabilities', type: 'liability', parentCode: '2000' },
  { code: '2190', name: 'مكافأة نهاية الخدمة', nameEn: 'End of Service Benefits', type: 'liability', parentCode: '2100' },

  { code: '2200', name: 'الخصوم غير المتداولة', nameEn: 'Non-current Liabilities', type: 'liability', parentCode: '2000', isHeader: true },
  { code: '2210', name: 'القروض طويلة الأجل', nameEn: 'Long-term Loans', type: 'liability', parentCode: '2200' },

  // حقوق الملكية - Equity 3000-3999
  { code: '3000', name: 'حقوق الملكية', nameEn: 'Equity', type: 'equity' },
  { code: '3000', name: 'حقوق الملكية', nameEn: 'Equity', type: 'equity', isHeader: true },
  { code: '3100', name: 'رأس المال', nameEn: 'Capital', type: 'equity', parentCode: '3000' },
  { code: '3200', name: 'الأرباح المحتجزة', nameEn: 'Retained Earnings', type: 'equity', parentCode: '3000' },
  { code: '3300', name: 'أرباح العام', nameEn: 'Current Year Earnings', type: 'equity', parentCode: '3000' },

  // الإيرادات - Revenue 4000-4999
  { code: '4000', name: 'الإيرادات', nameEn: 'Revenue', type: 'revenue' },
  { code: '4000', name: 'الإيرادات', nameEn: 'Revenue', type: 'revenue', isHeader: true },
  { code: '4100', name: 'إيرادات مقاولات', nameEn: 'Contracting Revenue', type: 'revenue', parentCode: '4000' },
  { code: '4110', name: 'إيرادات صيانة', nameEn: 'Maintenance Revenue', type: 'revenue', parentCode: '4000' },
  { code: '4120', name: 'إيرادات استشارات', nameEn: 'Consulting Revenue', type: 'revenue', parentCode: '4000' },
  { code: '4200', name: 'إيرادات أخرى', nameEn: 'Other Revenue', type: 'revenue', parentCode: '4000' },
  { code: '4250', name: 'خصم مكتسب', nameEn: 'Discount Received', type: 'revenue', parentCode: '4000' },
  { code: '4300', name: 'إيرادات فوائد', nameEn: 'Interest Income', type: 'revenue', parentCode: '4000' },

  // المصروفات - Expenses 5000-5999
  { code: '5000', name: 'المصروفات', nameEn: 'Expenses', type: 'expense' },
  { code: '5100', name: 'تكلفة مباشرة', nameEn: 'Direct Costs', type: 'expense', parentCode: '5000' },
  { code: '5000', name: 'المصروفات', nameEn: 'Expenses', type: 'expense', isHeader: true },
  { code: '5100', name: 'تكلفة مباشرة', nameEn: 'Direct Costs', type: 'expense', parentCode: '5000', isHeader: true },
  { code: '5110', name: 'مواد خام', nameEn: 'Raw Materials', type: 'expense', parentCode: '5100' },
  { code: '5120', name: 'أجور عمالة مباشرة', nameEn: 'Direct Labor', type: 'expense', parentCode: '5100' },
  
  { code: '5200', name: 'مصروفات تشغيلية', nameEn: 'Operating Expenses', type: 'expense', parentCode: '5000' },
  { code: '5130', name: 'تكاليف مقاولي باطن', nameEn: 'Subcontractor Costs', type: 'expense', parentCode: '5100' },
  { code: '5140', name: 'إيجار معدات', nameEn: 'Equipment Rental', type: 'expense', parentCode: '5100' },

  { code: '5200', name: 'مصروفات تشغيلية', nameEn: 'Operating Expenses', type: 'expense', parentCode: '5000', isHeader: true },
  { code: '5210', name: 'رواتب وأجور', nameEn: 'Salaries & Wages', type: 'expense', parentCode: '5200' },
  { code: '5220', name: 'إيجارات', nameEn: 'Rent', type: 'expense', parentCode: '5200' },
  { code: '5230', name: 'كهرباء ومياه', nameEn: 'Utilities', type: 'expense', parentCode: '5200' },
  { code: '5270', name: 'محروقات', nameEn: 'Fuel', type: 'expense', parentCode: '5200' },
  { code: '5280', name: 'قرطاسية ومطبوعات', nameEn: 'Stationery', type: 'expense', parentCode: '5200' },
  { code: '5290', name: 'مصروفات بنكية', nameEn: 'Bank Charges', type: 'expense', parentCode: '5200' },
  

  { code: '5300', name: 'مصروفات تسويقية', nameEn: 'Marketing Expenses', type: 'expense', parentCode: '5000' },
  { code: '5400', name: 'مصروفات إدارية وعمومية', nameEn: 'General & Admin Expenses', type: 'expense', parentCode: '5000' },
];

async function insertAccount(supabase: any, row: Record<string, unknown>) {
  const first = await supabase.from('accounts').insert(row).select('id').single();
  if (!first.error && first.data) return first;
  const msg = `${first.error?.message || ''} ${first.error?.code || ''}`;
  if (/is_header|42703|Could not find/i.test(msg)) {
    const { is_header: _drop, ...rest } = row as any;
    return supabase.from('accounts').insert(rest).select('id').single();
  }
  return first;
}

export async function ensureDefaultCashSafe(supabase: any, companyId: string, cashAccountId?: string | null) {
  const { data: existing } = await supabase
    .from('banks_safes')
    .select('id')
    .eq('company_id', companyId)
    .eq('type', 'safe')
    .limit(1)
    .maybeSingle();
  if (existing) return existing.id as string;

  let accountId = cashAccountId || null;
  if (!accountId) {
    const { data: cash } = await supabase
      .from('accounts')
      .select('id')
      .eq('company_id', companyId)
      .eq('code', '1110')
      .maybeSingle();
    accountId = cash?.id || null;
  }
  if (!accountId) return null;

  const { data: created } = await supabase
    .from('banks_safes')
    .insert({
      company_id: companyId,
      name: 'الخزينة الرئيسية',
      type: 'safe',
      account_id: accountId,
      opening_balance: 0,
      is_active: true,
    })
    .select('id')
    .single();

  return created?.id || null;
}

export async function createDefaultChartOfAccounts(supabase: any, companyId: string) {
  const accountMap = new Map<string, string>(); // code -> id


      if (existing) {
        accountMap.set(acc.code, existing.id);
        const shouldHeader = !!acc.isHeader || HEADER_ACCOUNT_CODES.has(acc.code);
        if (shouldHeader) {
          await supabase
            .from('accounts')
            .update({ is_header: true })
            .eq('id', existing.id)
            .eq('company_id', companyId);
        }
        continue;
      }

      const { data, error } = await supabase
        .from('accounts')
        .insert({
          company_id: companyId,
          code: acc.code,
          name: acc.name,
          name_en: acc.nameEn,
          type: acc.type,
          parent_id: null, // Will update in second pass
          is_active: true,
        })
        .select('id')
        .single();
      const isHeader = !!acc.isHeader || HEADER_ACCOUNT_CODES.has(acc.code);
      const { data, error } = await insertAccount(supabase, {
        company_id: companyId,
        code: acc.code,
        name: acc.name,
        name_en: acc.nameEn,
        type: acc.type,
        parent_id: null,
        is_active: true,
        is_header: isHeader,
      });

      if (!error && data) {
        accountMap.set(acc.code, data.id);
    }
  }

  // الخزينة في الدليل = خزينة حقيقية في قسم البنوك والخزائن
  try {
    await ensureDefaultCashSafe(supabase, companyId, accountMap.get('1110') || null);
  } catch (e) {
    console.warn('Failed to ensure default cash safe:', e);
  }

  return accountMap.size;
}

src/lib/form-utils.ts
+47
/** Normalize any date-like value to YYYY-MM-DD for <input type="date">. */
export function toDateInput(value: unknown): string {
  if (value == null || value === '') return '';
  const s = String(value).trim();
  if (/^\d{4}-\d{2}-\d{2}$/.test(s)) return s;
  const iso = s.match(/^(\d{4}-\d{2}-\d{2})[T\s]/);
  if (iso) return iso[1];
  const d = new Date(s);
  if (!Number.isNaN(d.getTime())) return d.toISOString().slice(0, 10);
  return '';
}

/** Unwrap `{ success, data }` or a raw payload. */
export function unwrapData<T = any>(json: any): T | null {
  if (!json) return null;
  if (json.success === false) return null;
  return (json.data ?? json) as T;
}

/** Same-origin GET that never throws. Used by every edit form. */
export async function fetchRecord(url: string): Promise<{ data: any | null; error: string | null }> {
  try {
    const res = await fetch(url, { credentials: 'same-origin' });
    const json = await res.json();
    if (json?.success && json.data) return { data: json.data, error: null };
    return { data: null, error: json?.message || 'تعذر تحميل البيانات' };
  } catch {
    return { data: null, error: 'خطأ في الاتصال بالخادم' };
  }
}

/** Normalize the listed date keys so `<input type="date">` shows the saved value. */
export function applyDates<T extends Record<string, any>>(obj: T, keys: string[]): T {
  const out = { ...obj };
  for (const k of keys) {
    if (k in out) (out as any)[k] = toDateInput(out[k]);
  }
  return out;
}

/**
 * Prefer the GET payload; if it failed, fall back to the list row so the
 * edit modal is never blank. Caller should toast `error` when data came from fallback.
 */
export function recordOrRow(fetched: any | null, row: any): any {
  return fetched || row || {};
}

src/migrations/012-atomic-journal-entry-insert.sql
+10
−2
  FOR v_line IN SELECT * FROM jsonb_array_elements(p_lines)
  LOOP
    INSERT INTO journal_lines (
      journal_entry_id, account_id, account_code,
      company_id, journal_entry_id, account_id, account_code, account_name,
      debit, credit, description, contact_id, project_id
    ) VALUES (
      p_company_id,
      v_entry_id,
      (v_line->>'accountId')::UUID,
      v_line->>'accountCode',
      COALESCE(
        NULLIF(v_line->>'accountCode', ''),
        (SELECT code FROM accounts WHERE id = (v_line->>'accountId')::UUID AND company_id = p_company_id)
      ),
      COALESCE(
        NULLIF(v_line->>'accountName', ''),
        (SELECT name FROM accounts WHERE id = (v_line->>'accountId')::UUID AND company_id = p_company_id)
      ),
      COALESCE((v_line->>'debit')::NUMERIC, 0),
      COALESCE((v_line->>'credit')::NUMERIC, 0),
      v_line->>'description',

src/migrations/014-atomic-invoice-creation.sql
+15
−8
    p_created_by
  ) RETURNING id INTO v_journal_id;

  -- Insert journal lines
  -- Insert journal lines (company_id is NOT NULL — must be set)
  -- Debit: Accounts Receivable
  INSERT INTO journal_lines (journal_entry_id, account_id, account_code, debit, credit, description)
  VALUES (v_journal_id, p_ar_account_id, '1130', p_total, 0, 'فاتورة مبيعات رقم ' || p_number);
  INSERT INTO journal_lines (company_id, journal_entry_id, account_id, account_code, account_name, debit, credit, description)
  VALUES (p_company_id, v_journal_id, p_ar_account_id, '1130',
          COALESCE((SELECT name FROM accounts WHERE id = p_ar_account_id AND company_id = p_company_id), 'ذمم العملاء'),
          p_total, 0, 'فاتورة مبيعات رقم ' || p_number);

  -- Credit: Revenue
  INSERT INTO journal_lines (journal_entry_id, account_id, account_code, debit, credit, description)
  VALUES (v_journal_id, p_revenue_account_id, '4100', 0, p_subtotal, 'إيراد فاتورة رقم ' || p_number);
  INSERT INTO journal_lines (company_id, journal_entry_id, account_id, account_code, account_name, debit, credit, description)
  VALUES (p_company_id, v_journal_id, p_revenue_account_id, '4100',
          COALESCE((SELECT name FROM accounts WHERE id = p_revenue_account_id AND company_id = p_company_id), 'إيرادات'),
          0, p_subtotal, 'إيراد فاتورة رقم ' || p_number);

  -- Credit: VAT (if applicable)
  IF p_vat_amount > 0 AND p_vat_account_id IS NOT NULL THEN
    INSERT INTO journal_lines (journal_entry_id, account_id, account_code, debit, credit, description)
    VALUES (v_journal_id, p_vat_account_id, '2120', 0, p_vat_amount, 'ضريبة فاتورة رقم ' || p_number);
    INSERT INTO journal_lines (company_id, journal_entry_id, account_id, account_code, account_name, debit, credit, description)
    VALUES (p_company_id, v_journal_id, p_vat_account_id, '2120',
            COALESCE((SELECT name FROM accounts WHERE id = p_vat_account_id AND company_id = p_company_id), 'ضريبة المبيعات'),
            0, p_vat_amount, 'ضريبة فاتورة رقم ' || p_number);
  END IF;

  -- Insert invoice items
  FOR v_item IN SELECT * FROM jsonb_array_elements(p_items)
  LOOP
    INSERT INTO invoice_items (invoice_id, description, quantity, unit_price, total)
    INSERT INTO invoice_items (company_id, invoice_id, description, quantity, unit_price, total)
    VALUES (
      p_company_id,
      v_invoice_id,
      v_item->>'description',
      COALESCE((v_item->>'quantity')::NUMERIC, 0),

src/migrations/022-fix-journal-lines-company-id.sql
+220
-- FIX: journal_lines.company_id is NOT NULL, but create_journal_entry /
-- create_invoice_with_journal omitted it, so every atomic journal insert
-- failed with:
--   null value in column "company_id" of relation "journal_lines" violates not-null constraint
--
-- This migration:
--   1. Recreates both RPCs so they write company_id (and account_name).
--   2. Adds a BEFORE INSERT trigger that backfills company_id / account
--      metadata if any leftover application path still omits them.

CREATE OR REPLACE FUNCTION create_journal_entry(
  p_company_id UUID,
  p_date DATE,
  p_type TEXT,
  p_description TEXT,
  p_created_by UUID,
  p_lines JSONB
)
RETURNS JSONB AS $$
DECLARE
  v_entry_id UUID;
  v_number INT;
  v_year INT;
  v_total_debit NUMERIC := 0;
  v_total_credit NUMERIC := 0;
  v_line JSONB;
  v_result JSONB;
BEGIN
  v_year := EXTRACT(YEAR FROM p_date);

  INSERT INTO journal_sequences(company_id, year, last_number)
  VALUES (p_company_id, v_year, 1)
  ON CONFLICT (company_id, year)
  DO UPDATE SET last_number = journal_sequences.last_number + 1
  RETURNING last_number INTO v_number;

  FOR v_line IN SELECT * FROM jsonb_array_elements(p_lines)
  LOOP
    v_total_debit := v_total_debit + COALESCE((v_line->>'debit')::NUMERIC, 0);
    v_total_credit := v_total_credit + COALESCE((v_line->>'credit')::NUMERIC, 0);
  END LOOP;

  IF ABS(v_total_debit - v_total_credit) > 0.01 THEN
    RAISE EXCEPTION 'خطأ في الموازنة: مجموع الديون (%) لا يساوي مجموع الدائنين (%)', v_total_debit, v_total_credit;
  END IF;

  IF EXISTS (
    SELECT 1
    FROM (
      SELECT l->>'accountCode' AS code,
             SUM(COALESCE((l->>'debit')::NUMERIC, 0))  AS d,
             SUM(COALESCE((l->>'credit')::NUMERIC, 0)) AS c
      FROM jsonb_array_elements(p_lines) AS l
      GROUP BY 1
    ) t
    WHERE t.d > 0 AND t.c > 0
  ) THEN
    RAISE EXCEPTION 'لا يجوز أن يكون نفس الحساب مديناً ودائناً في القيد الواحد';
  END IF;

  INSERT INTO journal_entries (company_id, number, date, type, description, created_by)
  VALUES (p_company_id, v_number, p_date, p_type, p_description, p_created_by)
  RETURNING id INTO v_entry_id;

  FOR v_line IN SELECT * FROM jsonb_array_elements(p_lines)
  LOOP
    INSERT INTO journal_lines (
      company_id, journal_entry_id, account_id, account_code, account_name,
      debit, credit, description, contact_id, project_id
    ) VALUES (
      p_company_id,
      v_entry_id,
      (v_line->>'accountId')::UUID,
      COALESCE(
        NULLIF(v_line->>'accountCode', ''),
        (SELECT code FROM accounts WHERE id = (v_line->>'accountId')::UUID AND company_id = p_company_id)
      ),
      COALESCE(
        NULLIF(v_line->>'accountName', ''),
        (SELECT name FROM accounts WHERE id = (v_line->>'accountId')::UUID AND company_id = p_company_id)
      ),
      COALESCE((v_line->>'debit')::NUMERIC, 0),
      COALESCE((v_line->>'credit')::NUMERIC, 0),
      v_line->>'description',
      (v_line->>'contactId')::UUID,
      (v_line->>'projectId')::UUID
    );
  END LOOP;

  SELECT jsonb_build_object(
    'id', v_entry_id,
    'number', v_number,
    'total_debit', v_total_debit,
    'total_credit', v_total_credit,
    'lines_count', jsonb_array_length(p_lines)
  ) INTO v_result;

  RETURN v_result;
END;
$$ LANGUAGE plpgsql;

CREATE OR REPLACE FUNCTION create_invoice_with_journal(
  p_company_id UUID,
  p_number INT,
  p_date DATE,
  p_due_date DATE,
  p_contact_id UUID,
  p_project_id UUID,
  p_subtotal NUMERIC,
  p_vat_rate NUMERIC,
  p_vat_amount NUMERIC,
  p_total NUMERIC,
  p_status TEXT,
  p_notes TEXT,
  p_created_by UUID,
  p_items JSONB,
  p_ar_account_id UUID,
  p_revenue_account_id UUID,
  p_vat_account_id UUID
)
RETURNS JSONB AS $$
DECLARE
  v_invoice_id UUID;
  v_journal_id UUID;
  v_item JSONB;
  v_result JSONB;
BEGIN
  INSERT INTO invoices (
    company_id, number, date, due_date, contact_id, project_id,
    subtotal, vat_rate, vat_amount, total, status, notes, created_by
  ) VALUES (
    p_company_id, p_number, p_date, p_due_date, p_contact_id, p_project_id,
    p_subtotal, p_vat_rate, p_vat_amount, p_total, p_status, p_notes, p_created_by
  ) RETURNING id INTO v_invoice_id;

  INSERT INTO journal_entries (
    company_id, number, date, type, description, reference, created_by
  ) VALUES (
    p_company_id, p_number, p_date, 'general',
    'فاتورة مبيعات رقم ' || p_number,
    'INV-' || p_number,
    p_created_by
  ) RETURNING id INTO v_journal_id;

  INSERT INTO journal_lines (company_id, journal_entry_id, account_id, account_code, account_name, debit, credit, description)
  VALUES (p_company_id, v_journal_id, p_ar_account_id, '1130',
          COALESCE((SELECT name FROM accounts WHERE id = p_ar_account_id AND company_id = p_company_id), 'ذمم العملاء'),
          p_total, 0, 'فاتورة مبيعات رقم ' || p_number);

  INSERT INTO journal_lines (company_id, journal_entry_id, account_id, account_code, account_name, debit, credit, description)
  VALUES (p_company_id, v_journal_id, p_revenue_account_id, '4100',
          COALESCE((SELECT name FROM accounts WHERE id = p_revenue_account_id AND company_id = p_company_id), 'إيرادات'),
          0, p_subtotal, 'إيراد فاتورة رقم ' || p_number);

  IF p_vat_amount > 0 AND p_vat_account_id IS NOT NULL THEN
    INSERT INTO journal_lines (company_id, journal_entry_id, account_id, account_code, account_name, debit, credit, description)
    VALUES (p_company_id, v_journal_id, p_vat_account_id, '2120',
            COALESCE((SELECT name FROM accounts WHERE id = p_vat_account_id AND company_id = p_company_id), 'ضريبة المبيعات'),
            0, p_vat_amount, 'ضريبة فاتورة رقم ' || p_number);
  END IF;

  FOR v_item IN SELECT * FROM jsonb_array_elements(p_items)
  LOOP
    INSERT INTO invoice_items (company_id, invoice_id, description, quantity, unit_price, total)
    VALUES (
      p_company_id,
      v_invoice_id,
      v_item->>'description',
      COALESCE((v_item->>'quantity')::NUMERIC, 0),
      COALESCE((v_item->>'unitPrice')::NUMERIC, 0),
      COALESCE((v_item->>'total')::NUMERIC, 0)
    );
  END LOOP;

  UPDATE invoices SET journal_entry_id = v_journal_id WHERE id = v_invoice_id;

  SELECT jsonb_build_object(
    'id', v_invoice_id,
    'number', p_number,
    'journalEntryId', v_journal_id,
    'total', p_total
  ) INTO v_result;

  RETURN v_result;
END;
$$ LANGUAGE plpgsql;

CREATE OR REPLACE FUNCTION fill_journal_line_defaults()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
BEGIN
  IF NEW.company_id IS NULL AND NEW.journal_entry_id IS NOT NULL THEN
    SELECT je.company_id INTO NEW.company_id
    FROM journal_entries je
    WHERE je.id = NEW.journal_entry_id;
  END IF;

  IF NEW.account_id IS NOT NULL AND (
       NEW.account_code IS NULL OR btrim(NEW.account_code) = ''
    OR NEW.account_name IS NULL OR btrim(NEW.account_name) = ''
  ) THEN
    SELECT
      COALESCE(NULLIF(btrim(NEW.account_code), ''), a.code),
      COALESCE(NULLIF(btrim(NEW.account_name), ''), a.name)
    INTO NEW.account_code, NEW.account_name
    FROM accounts a
    WHERE a.id = NEW.account_id
      AND (NEW.company_id IS NULL OR a.company_id = NEW.company_id);
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_fill_journal_line_defaults ON journal_lines;
CREATE TRIGGER trg_fill_journal_line_defaults
  BEFORE INSERT ON journal_lines
  FOR EACH ROW
  EXECUTE FUNCTION fill_journal_line_defaults();

src/migrations/023-fix-child-rows-company-id.sql
+180
-- FIX: child line tables (invoice_items, quotation_items, purchase_*_items, …)
-- have company_id NOT NULL, but several app/RPC inserts omitted it — same
-- class of bug as journal_lines (022).
--
-- This migration:
--   1. Recreates create_invoice_with_journal so invoice_items get company_id.
--   2. Adds a BEFORE INSERT trigger that backfills company_id from the parent
--      row for every known child table (defense in depth).

CREATE OR REPLACE FUNCTION create_invoice_with_journal(
  p_company_id UUID,
  p_number INT,
  p_date DATE,
  p_due_date DATE,
  p_contact_id UUID,
  p_project_id UUID,
  p_subtotal NUMERIC,
  p_vat_rate NUMERIC,
  p_vat_amount NUMERIC,
  p_total NUMERIC,
  p_status TEXT,
  p_notes TEXT,
  p_created_by UUID,
  p_items JSONB,
  p_ar_account_id UUID,
  p_revenue_account_id UUID,
  p_vat_account_id UUID
)
RETURNS JSONB AS $$
DECLARE
  v_invoice_id UUID;
  v_journal_id UUID;
  v_item JSONB;
  v_result JSONB;
BEGIN
  INSERT INTO invoices (
    company_id, number, date, due_date, contact_id, project_id,
    subtotal, vat_rate, vat_amount, total, status, notes, created_by
  ) VALUES (
    p_company_id, p_number, p_date, p_due_date, p_contact_id, p_project_id,
    p_subtotal, p_vat_rate, p_vat_amount, p_total, p_status, p_notes, p_created_by
  ) RETURNING id INTO v_invoice_id;

  INSERT INTO journal_entries (
    company_id, number, date, type, description, reference, created_by
  ) VALUES (
    p_company_id, p_number, p_date, 'general',
    'فاتورة مبيعات رقم ' || p_number,
    'INV-' || p_number,
    p_created_by
  ) RETURNING id INTO v_journal_id;

  INSERT INTO journal_lines (company_id, journal_entry_id, account_id, account_code, account_name, debit, credit, description)
  VALUES (p_company_id, v_journal_id, p_ar_account_id, '1130',
          COALESCE((SELECT name FROM accounts WHERE id = p_ar_account_id AND company_id = p_company_id), 'ذمم العملاء'),
          p_total, 0, 'فاتورة مبيعات رقم ' || p_number);

  INSERT INTO journal_lines (company_id, journal_entry_id, account_id, account_code, account_name, debit, credit, description)
  VALUES (p_company_id, v_journal_id, p_revenue_account_id, '4100',
          COALESCE((SELECT name FROM accounts WHERE id = p_revenue_account_id AND company_id = p_company_id), 'إيرادات'),
          0, p_subtotal, 'إيراد فاتورة رقم ' || p_number);

  IF p_vat_amount > 0 AND p_vat_account_id IS NOT NULL THEN
    INSERT INTO journal_lines (company_id, journal_entry_id, account_id, account_code, account_name, debit, credit, description)
    VALUES (p_company_id, v_journal_id, p_vat_account_id, '2120',
            COALESCE((SELECT name FROM accounts WHERE id = p_vat_account_id AND company_id = p_company_id), 'ضريبة المبيعات'),
            0, p_vat_amount, 'ضريبة فاتورة رقم ' || p_number);
  END IF;

  FOR v_item IN SELECT * FROM jsonb_array_elements(p_items)
  LOOP
    INSERT INTO invoice_items (company_id, invoice_id, description, quantity, unit_price, total)
    VALUES (
      p_company_id,
      v_invoice_id,
      v_item->>'description',
      COALESCE((v_item->>'quantity')::NUMERIC, 0),
      COALESCE((v_item->>'unitPrice')::NUMERIC, 0),
      COALESCE((v_item->>'total')::NUMERIC, 0)
    );
  END LOOP;

  UPDATE invoices SET journal_entry_id = v_journal_id WHERE id = v_invoice_id;

  SELECT jsonb_build_object(
    'id', v_invoice_id,
    'number', p_number,
    'journalEntryId', v_journal_id,
    'total', p_total
  ) INTO v_result;

  RETURN v_result;
END;
$$ LANGUAGE plpgsql;

-- Generic backfill: if a child row is inserted without company_id, copy it
-- from the parent document. Safe no-op when the parent/table is missing.
CREATE OR REPLACE FUNCTION fill_child_company_id()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
DECLARE
  v_parent TEXT;
  v_fk TEXT;
  v_id UUID;
BEGIN
  IF NEW.company_id IS NOT NULL THEN
    RETURN NEW;
  END IF;

  CASE TG_TABLE_NAME
    WHEN 'invoice_items' THEN
      v_parent := 'invoices'; v_fk := 'invoice_id'; v_id := NEW.invoice_id;
    WHEN 'quotation_items' THEN
      v_parent := 'quotations'; v_fk := 'quotation_id'; v_id := NEW.quotation_id;
    WHEN 'purchase_invoice_items' THEN
      v_parent := 'purchase_invoices'; v_fk := 'purchase_invoice_id'; v_id := NEW.purchase_invoice_id;
    WHEN 'purchase_order_items' THEN
      v_parent := 'purchase_orders'; v_fk := 'purchase_order_id'; v_id := NEW.purchase_order_id;
    WHEN 'salary_items' THEN
      v_parent := 'salary_sheets'; v_fk := 'sheet_id'; v_id := NEW.sheet_id;
    WHEN 'receipt_invoice_items' THEN
      v_parent := 'voucher_receipts'; v_fk := 'id'; v_id := NEW.voucher_receipt_id;
    WHEN 'disbursement_invoice_items' THEN
      v_parent := 'voucher_disbursements'; v_fk := 'id'; v_id := NEW.voucher_disbursement_id;
    WHEN 'progress_claim_items' THEN
      v_parent := 'progress_claims'; v_fk := 'id'; v_id := NEW.claim_id;
    WHEN 'pos_sale_items' THEN
      v_parent := 'pos_sales'; v_fk := 'id'; v_id := NEW.sale_id;
    WHEN 'credit_note_items' THEN
      v_parent := 'credit_notes'; v_fk := 'id'; v_id := NEW.credit_note_id;
    WHEN 'boq_items' THEN
      v_parent := 'projects'; v_fk := 'id'; v_id := NEW.project_id;
    WHEN 'journal_lines' THEN
      v_parent := 'journal_entries'; v_fk := 'id'; v_id := NEW.journal_entry_id;
    ELSE
      RETURN NEW;
  END CASE;

  IF v_id IS NULL THEN
    RETURN NEW;
  END IF;

  EXECUTE format('SELECT company_id FROM %I WHERE %I = $1', v_parent, v_fk)
    INTO NEW.company_id
    USING v_id;

  RETURN NEW;
END;
$$;

DO $$
DECLARE
  t TEXT;
  child_tables TEXT[] := ARRAY[
    'invoice_items',
    'quotation_items',
    'purchase_invoice_items',
    'purchase_order_items',
    'salary_items',
    'receipt_invoice_items',
    'disbursement_invoice_items',
    'progress_claim_items',
    'pos_sale_items',
    'credit_note_items',
    'boq_items'
  ];
BEGIN
  FOREACH t IN ARRAY child_tables LOOP
    BEGIN
      EXECUTE format('DROP TRIGGER IF EXISTS trg_fill_child_company_id ON %I', t);
      EXECUTE format(
        'CREATE TRIGGER trg_fill_child_company_id BEFORE INSERT ON %I FOR EACH ROW EXECUTE FUNCTION fill_child_company_id()',
        t
      );
    EXCEPTION WHEN undefined_table THEN
      NULL;
    END;
  END LOOP;
END $$;

src/migrations/024-account-headers-and-cash-link.sql
+27
-- 024: Mark chart-of-accounts group accounts as non-posting headers,
-- and ensure every company has a real cash box linked to account 1110.

ALTER TABLE accounts ADD COLUMN IF NOT EXISTS is_header BOOLEAN DEFAULT false;

UPDATE accounts SET is_header = true
WHERE code IN ('1000','1100','1200','2000','2100','2200','3000','4000','5000','5100','5200');

-- Fix accumulated-depreciation parent (should sit under fixed assets, not the root)
UPDATE accounts child
SET parent_id = parent.id
FROM accounts parent
WHERE child.code = '1290'
  AND parent.code = '1200'
  AND child.company_id = parent.company_id
  AND (child.parent_id IS DISTINCT FROM parent.id);

-- Link the default cash GL account to a real banks_safes row so it appears
-- under البنوك والخزائن (idempotent: skip companies that already have a safe).
INSERT INTO banks_safes (company_id, name, type, account_id, opening_balance, is_active)
SELECT a.company_id, 'الخزينة الرئيسية', 'safe', a.id, 0, true
FROM accounts a
WHERE a.code = '1110'
  AND NOT EXISTS (
    SELECT 1 FROM banks_safes b
    WHERE b.company_id = a.company_id AND b.type = 'safe'
  );

src/store/auth-store.ts
+2
−1
    try {
      const res = await fetch('/api/auth/login', {
        method: 'POST',
        credentials: 'same-origin',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email, password }),
      });
  },

  logout: async () => {
    try { await fetch('/api/auth/logout', { method: 'POST' }); } catch {}
    try { await fetch('/api/auth/logout', { method: 'POST', credentials: 'same-origin' }); } catch {}
    set({ user: null, company: null, isAuthenticated: false });
  },
## 2026-08-26 — المحور الثاني: نظام الإشعارات الدائنة/المدينة بديلاً عن تعديل الفاتورة + منع التعديل نهائياً

### قاعدة البيانات (`src/migrations/090-credit-debit-notes-invoice-immutability.sql`)
- عمود `note_type` على `credit_notes` (credit/debit) + قيد CHECK وفهارس.
- جدول `debit_note_sequences` ودالة `next_debit_note_number` — تسلسل DN مستقل.
- `invoice_net_total()` — صافي الفاتورة = الأصل + المدين المعتمد − الدائن المعتمد.
- `create_debit_note_atomic` — إشعار مدين ذري بقيد (من العملاء إلى الإيراد+الضريبة).
- `create_credit_note_atomic` — حد الإشعار الدائن على الصافي بدل الأصل فقط.
- `cancel_credit_note_atomic` — موحّد للنوعين بعنوان صحيح لكل نوع.
- سندات القبض (`create_voucher_receipt_atomic` 083، `respond_voucher_receipt_approval_v49_internal`، `cancel_voucher_receipt_atomic`) و`finalize_gateway_payment` — كل حدود التخصيص والحالات على الصافي.
- `cancel_sales_invoice_atomic` — يمنع الإلغاء مع إشعارات مدينة معتمدة أيضاً.
- مُشغِّل `trg_sales_invoices_immutable` — منع أي UPDATE يغير الحقول المحاسبية/التعريفية (حتى عبر service role)، ومنع الملاحظات إلا لحظة الإلغاء، ومنع إعادة فتح ملغاة.
- مُشغِّل `trg_invoice_items_immutable` — منع UPDATE/DELETE لبنود الفاتورة.
- حذف `update_sales_invoice_metadata` — لا مسار تعديل حتى في القاعدة.

### API
- حذف `PUT /api/invoices/[id]` نهائياً (405 تلقائياً) — الإلغاء فقط عبر PATCH.
- مسارات جديدة `/api/debit-notes` و`/api/debit-notes/[id]` (GET/POST/GET/DELETE).
- `credit-notes` و`credit-notes/[id]` تصفية `note_type='credit'`.
- `vouchers/unpaid-invoices` — `net_total` و`remaining` على أساس الصافي.

### الواجهة
- صفحة الفواتير: إزالة زر التعديل ومسار PUT، أزرار سريعة لإشعار دائن/مدين لكل فاتورة.
- صفحة الإشعارات: تبويبان (دائنة/مدينة)، ترقيم CN/DN، دعم الربط العميق `?invoice=&type=`، اشتقاق تلقائي للعميل/المشروع/الضريبة، عرض الضريبة والصافي.
- صفحة عرض الفاتورة: لوحة «الفاتورة غير قابلة للتعديل» مع ملخص الإشعارات والصافي وأزرار الإنشاء.

### التحقق
- `npx tsc --noEmit` نظيف، `npm run lint` بلا أخطاء، `npx jest` 195 مجموعة / 2128 اختبار ناجح.
- إعادة توليد `supabase-full-schema.sql` (91 ميجريشن). توثيق السياسة: `docs/credit-debit-notes-policy.md`.

## 2026-08-26 — تباين ألوان لوحة المطور وتنبيه الاشتراك + التصدير الاحترافي بدل النسخ الخام

### تباين الألوان (قابلية القراءة)
- `SubscriptionBanner`: خلفيات صلبة عالية التباين — منتهي: `bg-red-600` بنص أبيض، قارب على الانتهاء: `bg-amber-400` بنص داكن؛ أزرار بيضاء/داكنة صريحة بدل الشفاف غير المقروء.
- لوحة المطور zerocold — أزرار تغيير الباقة/التمديد/الإلغاء (subscriptions)، تعليق/تفعيل وإلغاء (companies)، حذف باقة (plans)، تفريغ السجلات (logs)، تسجيل الخروج (layout)، وتسميات قاعدة البيانات: ألوان صلبة بنص أبيض/فاتح واضح بدل `text-*-400/70` على `bg-*-950/20`.

### التصدير الاحترافي (بديل النسخ الخام)
- `src/lib/report-export.ts` جديد: 26 تقريراً محاسبياً منسّقاً (دليل الحسابات، دفتر اليومية، فواتير المبيعات وبنودها، عروض الأسعار، المشتريات، العملاء والموردون، المشاريع ومصروفاتها، الموظفون والسلف، العهد وحركاتها، الأصول، المخزون وحركاته، المستودعات، الفروع، البنوك والخزائن، النقدية، سندات القبض والصرف، الضمانات، الموازنات، مراكز التكلفة، الإقرارات الضريبية).
- كل تقرير: أعمدة عربية بأسماء أعمال، أسماء حقيقية (عميل/مشروع/حساب) بدل UUID، حالات مترجمة، مبالغ برقمين عشريين، لا معرفات تقنية.
- **استبعاد كامل** للجداول الحساسة من التصدير: `settings` (أسرار SMTP/تيليجرام) و`notifications` (و`users` وغيرها غير مقبولة أصلاً).
- CSV بـ UTF-8 BOM (عربية سليمة في Excel) + رأس لكل تقرير (اسم التقرير/الشركة/التاريخ/عدد السجلات)؛ Excel بجداول ملوّنة RTL ورؤوس بيضاء على كحلي.
- أسماء جداول قديمة (`clients, inventory, banks, vouchers, journal_lines`) تُحوَّل تلقائياً لتقاريرها.
- `/export-data` وsubscription وsettings وSidebar: صياغة «تقارير بياناتك» بدل «جداول».

### الاختبارات
- `professional-report-export.test.ts` جديد (10 اختبارات) + تحديث اختبارات دورة التصدير: عزل الشركات، اكتمال الترقيم فوق 2500 صف، رفض JSON، حسمية الجداول الحساسة.
- `npx tsc --noEmit` نظيف · `npm run lint` 0 أخطاء · `npx jest` 196 مجموعة / 2141 اختبار ناجح.

## 2026-08-26 — مراجعة شاملة لتعديلات الجلسة (المحور الثاني + التصدير + التباين)

### نتائج المراجعة وإصلاحاتها
1. **(محاسبي — ميجريشن 091 جديد)** دالّتا `get_vat_return_summary` و`get_project_billing_totals` في 061 كانتا تخصمان الإشعارات الدائنة دون إضافة المدينة — بعد تفعيل الإشعارات المدينة لأصبح صافي المبيعات الضريبية وbilling المشاريع ناقصاً:
   - صافي المبيعات الضريبية = الفواتير + المدين المعتمد − الدائن المعتمد (ضريبة المخرجات محسوبة من القيود فتشمل المدين أصلاً — أصبح الرقمان متطابقين).
   - بيلينغ المشاريع: عمود credits يصبح «صافي الإشعارات» (الدائن − المدين) لتبقى هوية `net_billed = billed − credits` صحيحة، مع تمييز `note_type` صريح في كل CTE.
2. **(جودة التصدير)** سلسلة lookups: تقرير «حركات العهد» كان لن يُظهر اسم الموظف — أُضيف نظام `deps` في `LOOKUP_DEFS` يوسّع الجداول المطلوبة تلقائياً (custodies → employees).
3. **(نظافة)** إزالة import ميت `isValidDate` من مسار الفواتير بعد حذف PUT.

### نقاط فُحصت و Fixed سليمة (بدون تغيير)
- رصيد الأطراف (contact-balance) محسوب من القيود الموسومة بـ contact_id → يعكس الدائن والمدين تلقائياً ✔
- أعلى العملاء بالإيراد من قيود حسابات الإيراد → يصافي النوعين تلقائياً ✔
- قائمة سماح مُشغِّل قفل الفواتير: paid_at/paid_amount/status/journal_entry_id/zatca_qr/tax_snapshot/updated_at/deleted_at فقط، والملاحظات لحظة الإلغاء حصراً ✔
- ترتيب القفل FOR UPDATE على صف الفاتورة أولاً في كل المسارات → لا deadlock مع invoice_net_total ✔
- أسماء الجداول القديمة في التصدير، BOM العربية، عزل الشركات في المصدر والlookups ✔

### التحقق بعد المراجعة
- `npx tsc --noEmit` نظيف · `npm run lint` 0 أخطاء (52 تحذير تراثي، أقل من الأساس 53) · `npx jest` 196 مجموعة / 2142 اختبار ناجح.
- إعادة توليد `supabase-full-schema.sql` (92 ميجريشن) · فحص نحوي للميجريشنين 090 و091 بـ libpg-query.

## 2026-08-29 — نظام الاشتراكات: رقم مشترك غير قابل للتخمين + الإيصالات عبر تليجرام + تنظيم العرض

### المتطلبات المنفذة
1. **(أمان — ميجريشن 114)** رقم المشترك كان تسلسلياً (`#1002`, `#1003`…) فيستطيع أي شخص يعرف رقماً واحداً تخمين أرقام الشركات الأخرى واستغلالها في هندسة اجتماعية على الدعم. صار `next_subscriber_number()` يولّد **كوداً عشوائياً من 12 خانة حروف وأرقام** بصيغة `XXXX-XXXX-XXXX` من أبجدية بلا رموز ملتبسة (بلا 0/O/1/I/L) — ≈31¹² احتمال — مع فحص تصادم ضد الجدول، وأُعيد إصدار كل الأرقام التسلسلية القديمة مرة واحدة، وحُذف `subscriber_number_seq` نهائياً حتى لا يعود الترقيم التسلسلي بأي مسار مستقبلي.
2. **(إصلاح ظهور)** `/api/auth/subscription-status` كان لا يُرجع `subscriber_number` فكان تاب الاشتراك في الإعدادات يعرض "—" (أو أسوأ: جزءاً من UUID الاشتراك كرقم بديل!). الآن يُرجعه الـ endpoint عبر `getSubscriptionAccess`، وأُزيل fallback الـ UUID من الصفحتين.
3. **(تنظيم العرض)** صفحة «الباقات والاشتراك» كانت تكرر نفس المعلومة في بطاقتين («اشتراكك الحالي» + «الإضافات المفعلة على اشتراكك» تكرر سطر المقاعد/الفروع). دُمجت في **بطاقة موحدة واحدة** (الباقة، الحالة، الانتهاء، رقائق الإضافات مع الإجماليات، رقم المشترك بزر نسخ)، ونُقل «تفعيل بكود» أسفل شبكة الباقات، وتبويب الدعم صار يفتح ببطاقة «إرسال إيصال الدفع» (تليجرام فقط). تاب الإعدادات صار بطاقة ملخص واحدة + زرا إدارة/تصدير بدل قوائم مكررة.
4. **(تدفق الترقية/التجديد — ميجريشن 115)**
   - **لا رفع لصور الإيصالات إطلاقاً**: حُذف مسار `/api/upload/receipt` بالكامل، والـ RPCs (`create_upgrade_request_atomic` / `create_addon_request_atomic`) ترفض أي مرجع إيصال غير NULL، ويطلب الـ API رسالة واضحة («أرسل الإيصال عبر تليجرام»).
   - نوافذ الطلب صارت **خطوات عملية**: طرق الدفع المعتمدة ← زر «فتح تليجرام الدعم» مع رقم المشترك وزر نسخ بجانبه ← إدخال بيانات التحويل (الطريقة/المبلغ/التاريخ/الوقت) وإرسال الطلب. تبديل شهري/سنوي يحدّث المبلغ تلقائياً.
   - **إشعار بوت المطور**: كل طلب ترقية/إضافة جديد يبعث رسالة HTML مهربة الميتا على `sendAdminNotification` تتضمن **رقم المشترك** ليتطابق مع إيصال التليجرام فوراً (بحارس Abort بعد 10 ثوانٍ داخل `lib/telegram.ts` كنظيره في `sendTelegramCode`، ولا يفشل الطلب عند تعذر التليجرام).
   - **اعتماد بلا ملف مخزن**: `review_upgrade_request` / `review_addon_request` لم يعودا يشترطان `receipt_image_url` — يكفي تاريخ تحويل + المبلغ الكامل (المطور يطابق الصورة في محادثة تليجرام). حرس المبلغ الكتالوجي وبند «طلب واحد معلق» باقيان.
   - **إلغاء ذاتي**: RPC جديد `cancel_own_subscription_request` + `DELETE` على مساري الطلبات يتيح للعميل سحب طلبه المعلق (يحرر فهرس «طلب معلق واحد» فيستطيع إعادة الإرسال بعد خطأ). لوحة المطور تعرض رقم المشترك وشارة «الإيصال عبر تليجرام» (الروابط الموقعة بقيت للسجلات القديمة).
   - **إصلاح تجنيس**: زر الباقة الحالية كان معطلاً — لا يستطيع المشترك المنتهي تجديد نفس باقته! الآن «تجديد نفس الباقة» مفعّل (فقط التجريبية تبقى غير قابلة للطلب).
   - `/api/app-settings` أُضيف لقائمة السماح بعد انتهاء الاشتراك (صفحة التجديد تحتاج جهة تليجرام الدعم)، وحُذف `/api/upload/receipt` منها.

### التحقق
- `npx tsc --noEmit` نظيف · `npm run lint` 0 أخطاء · `npx jest --runInBand` **204 مجموعات / 2215 اختبار ناجح** (تغطية lib المعدلة 100%: subscription-guard.ts وtelegram.ts) · `npm run test:migrations` (PGlite) ناجح · `npm run build` ناجح.
- تحقق تشغيلي على PGlite بكامل السلسلة (116 ميجريشن): 21 اشتراكاً جديداً جميعها بأكواد فريدة بالصيغة الصحيحة وبلا رموز ملتبسة، إعادة تعبئة الرقم المحذوف عبر الـ trigger بكود عشوائي جديد، طلب ترقية بمرجع إيصال NULL يُقبل وبمرجع غير NULL يُرفض، الإلغاء الذاتي يحرر خانة «المعلق»، والاعتماد ينجح ببرهان تليجرام فقط ويمدد الاشتراك.
- إعادة توليد `supabase-full-schema.sql` (116 ميجريشن) · تحديث MIGRATIONS.md (114/115).

## 2026-08-29 — إصلاح فشل إنشاء فاتورة المبيعات وفشل الاستلام الجزئي/الكلي (مبيعات ومشتريات)

### الأعراض
- `POST /api/invoices` يرجع 400 أو 500 («حدث خطأ في الخادم / خطأ في النظام») عند إنشاء فاتورة مبيعات.
- فشل عند اختيار تحصيل/سداد جزئي أو كلي عند الإصدار (مبيعات ومشتريات)، وفشل سندات القبض/الصرف المخصصة على الفواتير.

### الجذور المكتشفة (تحقق تشغيلي على PGlite بكامل الـ116 ميجريشن)
1. **(400 — الواجهة ترسل مبالغ غير مقرّبة)** نموذج الفاتورة كان يحسب `vatAmount = subtotal × rate` بلا تقريب (مثل 33.33 × 15% = **4.9995**) ويرسل `item.total/subtotal/vatAmount/total` كما هي، بينما `invoiceSchema` يرفض أي مبلغ لا يمثل منزلتين عشريتين تماماً (`hasTwoDecimals`). أي ضريبة بكسر ناقص كانت تُسقط الفاتورة بخطأ تحقق — أغلب الأسعار الواقعية مصابة. حتى **سعر الوحدة** بثلاث منازل (33.335) كان يُرفض برسالة 400 عامة.
2. **(500 — رسائل الرفض المحاسبية كانت تُخفى)** كل `RAISE EXCEPTION` عربي من دوال RPC الذرية (`create_sales_invoice_atomic`، `create_voucher_receipt_atomic`، `create_voucher_disbursement_atomic`، `create_purchase_invoice_atomic`، القيود، المخزون) كان يسقط في `serverError` العام لأن `handleApiError` لا يترجم إلا رسالتي السنة المالية — فيرى المستخدم «خطأ في النظام» بدل السبب الحقيقي («الرصيد غير كاف للصرف»، «التخصيص يتجاوز المتبقي»، «البنك أو الخزينة غير موجود»…).
3. **(500 — دوال غير مثبتة على قاعدة البيانات الحية)** إذا لم تُطبَّق الميجريشنز الأحدث على Supabase يرجع PostgREST `PGRST202` (Could not find the function) → 500 عام بلا تفسير. ملاحظة تشغيلية: سلاسل الفواتير/السندات نفسها **سليمة على مستوى قاعدة البيانات** (A–K كلها نجحت بأرقام نظيفة) — فشل الإنتاج الأرجح إما التحقق (1) أو قاعدة بيانات غير محدثة (3).

### الإصلاحات
1. **`roundMoney` جديد في `lib/utils`**: تقريب منزلتين بنصف خانة نحو الأعلى مطابق لـ ROUND في PostgreSQL مع تعويض انحراف الفاصلة العائمة.
2. **نموذج فاتورة المبيعات**: تقريب إجمالي البند عند أي تغيير (quantity/unitPrice/discount)، وتقريب subtotal/vatAmount/total في الحساب والعرض والإرسال، وسقف `collected_amount` عند إجمالي الفاتورة، وتحقق فوري من منازل الكمية وسعر الوحدة برسالة عربية واضحة قبل الإرسال.
3. **`CashSettlementFields`**: «كامل» = الإجمالي المقرّب دائماً؛ «جزئي» لا يتجاوز الإجمالية؛ المتبقي مقرّب.
4. **نموذج فاتورة المشتريات**: تقريب المجاميع، سقف `paid_amount` عند الإجمالي مع رسالة فورية، تحقق منازل السعر/الكمية.
5. **`handleApiError`**: قائمة سماح من رسائل الرفض المحاسبي الثابتة (مع الأنماط المُكملة بمعاملات) تُرجع **400 بنص السبب الحقيقي** بدل 500؛ وترجمة `PGRST202/PGRST203` و«function … does not exist» إلى **503 برسالة «طبّق الميجريشنز المعلقة»** (مع تسجيل اسم الدالة الناقصة في سجل الخادم).
6. سلاسل سند القبض/الصرف على فواتير قائمة تحققت حية: جزئي ثم كامل المتبقي يجعل الفاتورة `paid` (مبيعات 38.33/38.33 ومشتريات 230/230).

### التحقق
- تحقق تشغيلي (PGlite، 116 ميجريشن): إنشاء فاتورة 33.33+ضريبة (كانت تُرفض 400) ✓، استلام جزئي ثم كامل → `paid` ✓، تحصيل فوري كامل/جزئي ✓، فاتورة نصف-خانة (3×33.34) ✓، مشتريات سداد جزئي/كامل فوري + سند صرف متبقٍّ → `paid` ✓، رفض مرجع صورة في طلب الترقية ✓ — **11/11**.
- `invoiceSchema` على حمولات «قبل/بعد»: قبل `مبلغ الضريبة يجب ألا يتجاوز منزلتين عشريتين` ✗ → بعد مقبولة ✓.
- `npx tsc --noEmit` نظيف · eslint 0 أخطاء · jest **205 مجموعات / 2248 اختبار** (منها 33 جديدة: ترجمة الأخطاء + roundMoney) · `npm run test:migrations` · `npm run build` — كلها ناجحة.

### ملاحظة تشغيلية للمطور
إذا استمر ظهور «دالة قاعدة البيانات المطلوبة غير مثبتة» بعد التحديث: طبّق الميجريشنز المعلقة على قاعدة البيانات الحية (`npx tsx src/migrations/run.ts`) — أرقام الإصدارات من 097 فما فوق تضيف معاملات العملة/السداد للدوال الذرية.

## 2026-08-29 — إلغاء مرفقات مستندات العقود من التخزين (ميجريشن 116)

### القرار
بعد إلغاء إيصالات الدفع المخزنة (115) أُلغيت آخر ميزة ترفع ملفات إلى تخزين Supabase: مستندات العقود (PDF/صور في دلو `contract-documents`). الهدف: صفر ملفات على قاعدة البيانات/التخزين حتى لا تزدحم المساحة — الملفات تتبادل خارجياً (تليجرام).

### ما نُفّذ
1. **(ميجريشن 116)** يسقط `create_contract_document_atomic` وجدول `contract_documents` بسياسته وفهارسه، ويعيد كتابة `delete_draft_contract_atomic` بلا تجميع مسارات تخزين، ويعيد تركيب محفزات حراسة العلاقات دون الجدول المحذوف، و**يفرّغ دلو `contract-documents` من كائناته ويمسح الدلو** من `storage` (خطوة محمولة تتخطى محركات بلا مخطط storage) — يحرر مساحة Supabase فعلياً.
2. **التطبيق**: حذف `POST /api/contracts/[id]` (الرفع) و`GET /api/contracts/[id]/documents/[documentId]` (التنزيل الموقّع) بالكامل؛ GET العقد لم يعد يرجع `documents`؛ DELETE بلا تنظيف تخزين.
3. **المكتبات**: حذف `contractDocumentSchema` من relationship-validation، و`hasAllowedMagicBytes` ومساعداته من safe-input، و`countUsedStorageBytes` من plan-limits (لم يعد له مستدعٍ — لم يعد هناك رفع يُحسب).
4. **الاختبارات**: تحديث 10 ملفات اختبار (contract-detail-post يثبت الآن أن POST لم يعد موجوداً؛ relationship-integrity يثبت محتوى 116؛ إعادة كتابة plan-storage-functions على hasModule فقط؛ audit-hardening وsafe-input وresidual-pure-functions بلا دوال الملفات المحذوفة).
5. **العقود نفسها بقيت كاملة** (إنشاء/تعديل/انتقال حالة/حذف مسودة عبر الـ RPCs الذرية) — أُلغي فقط مرفق الملفات.

### التحقق
- `npm run test:migrations` ناجح (يشمل تأكيدات 116: الجدول والدالة محلّيان، حذف المسودة يعمل بلا storage_paths).
- `npx tsc --noEmit` نظيف · eslint 0 أخطاء (67 تحذيراً تراثياً) · jest **205 مجموعات / 2213 اختبار ناجح** · `npm run build` ناجح · إعادة توليد `supabase-full-schema.sql` (117 ميجريشن).
