/**
 * اختبارات المحور الثاني — نظام الإشعارات الدائنة/المدينة بديلاً عن تعديل
 * الفاتورة + قفل تعديل الفواتير نهائياً:
 *   1. مسارات /api/debit-notes (قائمة/إنشاء/تفاصيل/إلغاء).
 *   2. عزل النوعين (credit vs debit) على نفس الجدول credit_notes.
 *   3. حدود الإشعار الدائن على صافي الفاتورة في SQL (فحص نصي للميجريشن).
 *   4. مشغّلات قفل الفواتير (trg_sales_invoices_immutable / trg_invoice_items_immutable).
 */
process.env.TOKEN_SECRET = 'test-secret-key-for-unit-tests-32chars!';
import { createToken } from '@/lib/auth';
import fs from 'fs';
import path from 'path';

type Row = Record<string, unknown>;
type Op = { op: string; col?: string; val?: unknown };

function makeDb(db: Record<string, Row[]>) {
  const calls: Array<{ table: string; ops: Op[] }> = [];
  const rpcCalls: Array<{ name: string; args: Record<string, unknown> }> = [];
  const rpcResults = new Map<string, { data: unknown; error?: unknown } | null>();
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
          if (o.op === 'in') return (o.val as unknown[]).map(String).includes(String(get(o.col!)));
          return true;
        })
      );
    const api: TestBuilder = {
      select: () => api,
      eq: (col: string, val: unknown) => { ops.push({ op: 'eq', col, val }); return api; },
      in: (col: string, val: unknown) => { ops.push({ op: 'in', col, val }); return api; },
      order: () => api, limit: () => api, range: () => api, is: () => api, neq: () => api,
      or: () => api, lt: () => api, gte: () => api, lte: () => api,
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
    from, calls, rpcResults, rpcCalls,
    rpc: async (name: string, args: Record<string, unknown>) => {
      rpcCalls.push({ name, args });
      return rpcResults.get(name) || { data: null, error: null };
    },
  };
}

let mockDb: ReturnType<typeof makeDb>;
jest.mock('@/lib/supabase-client', () => ({ getSupabase: () => mockDb }));

import { GET as dnGET, POST as dnPOST } from '@/app/api/debit-notes/route';
import { GET as dnDetailGET, DELETE as dnDetailDELETE } from '@/app/api/debit-notes/[id]/route';
import { GET as cnGET } from '@/app/api/credit-notes/route';
import { GET as unpaidGET } from '@/app/api/vouchers/unpaid-invoices/route';
import type { TestBuilder } from './mocks';
import type { NextRequest } from 'next/server';
import { resetRateLimits } from '@/lib/memory-rate-limit';

const C1 = 'company-1';
const ID1 = '00000000-0000-4000-8000-00000000e1d1';
const INV1 = '00000000-0000-4000-8000-00000000a001';
const CT1 = '00000000-0000-4000-8000-00000000c001';
const rpcName = (i: number) => mockDb.rpcCalls.filter((c) => c.name !== 'hit_rate_limit')[i]?.name;

function req(role = 'admin', method = 'GET', url = 'http://localhost/x', body?: Row) {
  const token = createToken('u1', role, 0);
  return { url, method, nextUrl: new URL(url), headers: { get: (k: string) => k === 'authorization' ? `Bearer ${token}` : null },
    cookies: { get: () => undefined }, json: async () => body } as unknown as NextRequest;
}

function baseDb() {
  return {
    users: [{ id: 'u1', company_id: C1, name: 'م', email: 'admin@example.com', is_active: true, token_version: 0, role: 'admin' }],
    companies: [{ id: C1, is_active: true }],
    subscriptions: [{ id: 's1', company_id: C1, status: 'active', end_date: '2099-01-01', plan_code: 'enterprise',
      subscription_plans: { code: 'enterprise', features_modules: { credit_notes: true, invoices: true } } }],
    credit_notes: [], credit_note_items: [], contacts: [], invoices: [], projects: [],
  } as Record<string, Row[]>;
}

beforeEach(() => { resetRateLimits(); mockDb = makeDb(baseDb()); });

describe('debit-notes — الإشعارات المدينة', () => {
  test('GET يسرد إشعارات note_type=debit فقط مع الأسماء', async () => {
    mockDb = makeDb({
      ...baseDb(),
      credit_notes: [
        { id: ID1, company_id: C1, note_type: 'debit', contact_id: 'c1', invoice_id: INV1, project_id: 'p1', total: 115 },
        { id: '00000000-0000-4000-8000-00000000e1d2', company_id: C1, note_type: 'credit', contact_id: 'c1', total: 50 },
      ],
      contacts: [{ id: 'c1', name: 'عميل', company_id: C1 }],
      invoices: [{ id: INV1, number: 12, company_id: C1 }],
      projects: [{ id: 'p1', name: 'مشروع', company_id: C1 }],
    });
    const res = await dnGET(req('admin', 'GET', 'http://localhost/api/debit-notes'));
    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.data.debit_notes).toHaveLength(1);
    expect(json.data.debit_notes[0].note_type).toBe('debit');
    expect(json.data.debit_notes[0].contact_name).toBe('عميل');
    expect(json.data.debit_notes[0].invoice_number).toBe(12);
  });

  test('GET يرفض مرشحات غير صالحة', async () => {
    const res1 = await dnGET(req('admin', 'GET', 'http://localhost/api/debit-notes?projectId=bad'));
    expect(res1.status).toBe(400);
    const res2 = await dnGET(req('admin', 'GET', 'http://localhost/api/debit-notes?invoiceId=bad'));
    expect(res2.status).toBe(400);
  });

  test('POST ينشئ إشعاراً مديناً عبر create_debit_note_atomic', async () => {
    mockDb.rpcResults.set('create_debit_note_atomic', { data: { id: ID1, note_type: 'debit' }, error: null });
    const res = await dnPOST(req('admin', 'POST', 'http://localhost/api/debit-notes', {
      invoice_id: INV1, reason: 'أعمال إضافية', items: [{ description: 'بند', quantity: 2, unit_price: 50 }],
      date: '2026-01-05', tax_rate: 0.15,
    }));
    expect(res.status).toBe(201);
    expect(rpcName(0)).toBe('create_debit_note_atomic');
    expect((mockDb.rpcCalls.find((c) => c.name === 'create_debit_note_atomic')?.args as Record<string, unknown>).p_invoice_id).toBe(INV1);
  });

  test('POST يرفض السبب المفقود والبنود غير الصالحة ونسبة ضريبة خاطئة', async () => {
    const res1 = await dnPOST(req('admin', 'POST', 'http://localhost/api/debit-notes', {}));
    expect(res1.status).toBe(400);
    const res2 = await dnPOST(req('admin', 'POST', 'http://localhost/api/debit-notes', { reason: 'سبب', items: [] }));
    expect(res2.status).toBe(400);
    const res3 = await dnPOST(req('admin', 'POST', 'http://localhost/api/debit-notes', {
      reason: 'سبب', items: [{ description: 'بند', quantity: 1, unit_price: 10 }], tax_rate: 5,
    }));
    expect(res3.status).toBe(400);
    const res4 = await dnPOST(req('admin', 'POST', 'http://localhost/api/debit-notes', {
      reason: 'سبب', items: [{ description: 'بند', quantity: 1, unit_price: 10 }], invoice_id: 'bad-uuid',
    }));
    expect(res4.status).toBe(400);
  });

  test('POST يمرّر خطأ الـ RPC (تجاوز رصيد/فاتورة ملغاة) برمز 4xx/5xx', async () => {
    mockDb.rpcResults.set('create_debit_note_atomic', { data: null, error: { message: 'الفاتورة غير صالحة' } });
    const res = await dnPOST(req('admin', 'POST', 'http://localhost/api/debit-notes', {
      invoice_id: INV1, reason: 'سبب', items: [{ description: 'بند', quantity: 1, unit_price: 10 }],
    }));
    expect(res.status).toBeGreaterThanOrEqual(400);
  });
});

describe('debit-notes/[id]', () => {
  test('GET يرجع الإشعار المدين مع البنود، و404 لغير المدين', async () => {
    mockDb = makeDb({
      ...baseDb(),
      credit_notes: [
        { id: ID1, company_id: C1, note_type: 'debit', contact_id: 'c1', invoice_id: INV1 },
        { id: '00000000-0000-4000-8000-00000000e1d3', company_id: C1, note_type: 'credit' },
      ],
      credit_note_items: [{ id: 'it1', credit_note_id: ID1, company_id: C1 }],
      contacts: [{ id: 'c1', name: 'عميل', company_id: C1 }],
      invoices: [{ id: INV1, number: 12, company_id: C1 }],
      projects: [],
    });
    const res = await dnDetailGET(req('admin', 'GET', `http://localhost/x/${ID1}`), { params: Promise.resolve({ id: ID1 }) });
    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.data.items).toHaveLength(1);
    expect(json.data.invoice_number).toBe(12);

    // إشعار دائن غير مرئي عبر مسار المدين
    const res2 = await dnDetailGET(req('admin', 'GET', 'http://localhost/x/00000000-0000-4000-8000-00000000e1d3'),
      { params: Promise.resolve({ id: '00000000-0000-4000-8000-00000000e1d3' }) });
    expect(res2.status).toBe(404);
  });

  test('GET يرفض معرفاً غير صالح', async () => {
    const res = await dnDetailGET(req('admin', 'GET', 'http://localhost/x'), { params: Promise.resolve({ id: 'bad' }) });
    expect(res.status).toBe(400);
  });

  test('DELETE يلغي الإشعار المدين بقيد عكسي', async () => {
    mockDb.rpcResults.set('cancel_credit_note_atomic', { data: { id: ID1, status: 'cancelled' }, error: null });
    const res = await dnDetailDELETE(req('admin', 'DELETE', `http://localhost/x/${ID1}`), { params: Promise.resolve({ id: ID1 }) });
    expect(res.status).toBe(200);
    expect(rpcName(0)).toBe('cancel_credit_note_atomic');
  });
});

describe('عزل النوعين في قوائم credit-notes', () => {
  test('GET /api/credit-notes لا يُظهر الإشعارات المدينة', async () => {
    mockDb = makeDb({
      ...baseDb(),
      credit_notes: [
        { id: '00000000-0000-4000-8000-00000000e1d4', company_id: C1, note_type: 'credit', contact_id: 'c1' },
        { id: '00000000-0000-4000-8000-00000000e1d5', company_id: C1, note_type: 'debit', contact_id: 'c1' },
      ],
      contacts: [{ id: 'c1', name: 'عميل', company_id: C1 }],
      invoices: [], projects: [],
    });
    const res = await cnGET(req('admin', 'GET', 'http://localhost/api/credit-notes'));
    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.data.credit_notes).toHaveLength(1);
    expect(json.data.credit_notes[0].note_type).toBe('credit');
  });
});

describe('unpaid-invoices — المتبقي على أساس الصافي بعد الإشعارات', () => {
  test('المتبقي = الأصل + المدين − الدائن − المدفوع', async () => {
    mockDb = makeDb({
      ...baseDb(),
      contacts: [{ id: CT1, name: 'عميل', company_id: C1, type: 'client', is_active: true }],
      invoices: [
        { id: INV1, number: 1, date: '2026-01-01', total: 1000, paid_amount: 400, status: 'partial', company_id: C1, contact_id: CT1 },
      ],
      credit_notes: [
        { invoice_id: INV1, note_type: 'credit', total: 100, status: 'approved', company_id: C1 },
        { invoice_id: INV1, note_type: 'debit', total: 60, status: 'approved', company_id: C1 },
        { invoice_id: INV1, note_type: 'credit', total: 999, status: 'cancelled', company_id: C1 },
      ],
    });
    const res = await unpaidGET(req('admin', 'GET', `http://localhost/api/vouchers/unpaid-invoices?contactId=${CT1}`));
    expect(res.status).toBe(200);
    const json = await res.json();
    const inv = json.data.invoices[0];
    expect(inv.net_total).toBe(960);       // 1000 + 60 − 100
    expect(inv.remaining).toBe(560);       // 960 − 400
  });

  test('يرفض معرف عميل غير صالح', async () => {
    const res = await unpaidGET(req('admin', 'GET', 'http://localhost/api/vouchers/unpaid-invoices?contactId=bad'));
    expect(res.status).toBe(400);
  });
});

describe('ميجريشن 090 — قفل الفواتير والصافي (فحص نصي للـ SQL)', () => {
  const migrationPath = path.join(process.cwd(), 'src', 'migrations', '090-credit-debit-notes-invoice-immutability.sql');
  const sql = fs.existsSync(migrationPath) ? fs.readFileSync(migrationPath, 'utf8') : '';

  test('يمنع تعديل الفواتير وبنودها على مستوى قاعدة البيانات', () => {
    expect(sql).toContain('trg_sales_invoices_immutable');
    expect(sql).toContain('enforce_sales_invoice_immutable');
    expect(sql).toContain('trg_invoice_items_immutable');
    expect(sql).toContain('BEFORE UPDATE OR DELETE ON invoice_items');
    expect(sql).toContain('DROP FUNCTION IF EXISTS public.update_sales_invoice_metadata');
  });

  test('صافي الفاتورة يدخل في حدود التحصيل والإشعار الدائن', () => {
    expect(sql).toContain('FUNCTION public.invoice_net_total');
    expect(sql).toContain("note_type IN ('credit', 'debit')");
    expect(sql).toContain('FUNCTION public.create_debit_note_atomic');
    expect(sql).toContain('FUNCTION public.next_debit_note_number');
    expect(sql).toContain('debit_note_sequences');
    // سندات القبض والاعتماد والدفع الإلكتروني كلها على الصافي
    expect(sql).toContain('CREATE OR REPLACE FUNCTION public.create_voucher_receipt_atomic(');
    expect(sql).toContain('CREATE OR REPLACE FUNCTION public.respond_voucher_receipt_approval_v49_internal(');
    expect(sql).toContain('CREATE OR REPLACE FUNCTION public.cancel_voucher_receipt_atomic(');
    expect(sql).toContain('CREATE OR REPLACE FUNCTION public.finalize_gateway_payment(');
    expect((sql.match(/invoice_net_total\(p_company_id,v_invoice.id\)/g) || []).length).toBeGreaterThanOrEqual(10);
  });

  test('حد الإشعار الدائن يعتمد الصافي لا الأصل فقط', () => {
    expect(sql).toContain('الأصل + المدين − الدائن المعتمد');
    expect(sql).not.toContain('v_credited+v_total>v_invoice.total');
  });

  test('ميجريشن 091 — الإشعارات المدينة تدخل صافي المبيعات الضريبية وبيلينغ المشاريع', () => {
    const netting = fs.readFileSync(path.join(process.cwd(), 'src', 'migrations', '091-debit-notes-report-netting.sql'), 'utf8');
    expect(netting).toContain('CREATE OR REPLACE FUNCTION public.get_vat_return_summary(');
    expect(netting).toContain("'totalSales',GREATEST(sales.total_sales+debits.debit_sales-credits.credit_sales,0)");
    expect(netting).toContain('CREATE OR REPLACE FUNCTION public.get_project_billing_totals(');
    // عمود credits = الدائن − المدين لتبقى هوية net = billed − credits
    expect(netting).toContain('COALESCE(c.amount,0)-COALESCE(d.amount,0)');
    // التمييز الصريح بين النوعين في CTEs
    expect((netting.match(/cn\.note_type='credit'/g) || []).length).toBeGreaterThanOrEqual(2);
    expect((netting.match(/cn\.note_type='debit'/g) || []).length).toBeGreaterThanOrEqual(2);
  });

  test('ميجريشن 092 — تقادم الذمم ومؤشرات الفواتير صافية بعد المدين/الدائن', () => {
    const aging = fs.readFileSync(path.join(process.cwd(), 'src', 'migrations', '092-notes-aware-aging-and-kpis.sql'), 'utf8');
    // إعادة تعريف دوال التقادم والمؤشرات الثلاث
    expect(aging).toContain('CREATE OR REPLACE FUNCTION public.get_aging_by_contact(');
    expect(aging).toContain('CREATE OR REPLACE FUNCTION public.get_receivable_aging(');
    expect(aging).toContain('CREATE OR REPLACE FUNCTION public.get_assistant_company_snapshot(');
    // القيد في دوال التقادم صافٍ موقّع: المدين يُعاد للرصيد لا أن يخصم
    expect((aging.match(/sum\(CASE WHEN cn\.note_type='debit' THEN -cn\.total ELSE cn\.total END\)/g) || []).length).toBe(2);
    // مؤشرات المساعد: المستحق والمتأخر = الأصل − المدفوع + صافي الإشعارات
    expect((aging.match(/i\.total-COALESCE\(i\.paid_amount,0\)\+COALESCE\(nn\.net,0\)/g) || []).length).toBe(2);
    expect(aging).toContain('LEFT JOIN notes_net nn ON nn.invoice_id=i.id');
  });

  test('ميجريشن 093 — خصم بند الفاتورة نسبة مئوية متسقة بين الواجهة والخلفية', () => {
    const m = fs.readFileSync(path.join(process.cwd(), 'src', 'migrations', '093-invoice-line-discount-percent.sql'), 'utf8');
    expect(m).toContain('CREATE OR REPLACE FUNCTION public.create_sales_invoice_atomic(');
    // صافي البند = gross − round(gross × %، 2) في الإجمالي وفي بنود الفاتورة
    expect((m.match(/round\(v_gross \* v_discount \/ 100, 2\)/g) || []).length).toBe(1);
    expect((m.match(/round\(v_qty \* v_price \* v_discount \/ 100, 2\)/g) || []).length).toBe(1);
    // الحد صار 0..100 بدل 0..gross
    expect(m).toContain('OR v_discount < 0 OR v_discount > 100');
    expect(m).not.toContain('v_discount > v_gross');
  });

  test('ميجريشن 094 — تكلفة البضاعة المباعة تلقائيًا من بنود الفاتورة المخزنية', () => {
    const cogs = fs.readFileSync(path.join(process.cwd(), 'src', 'migrations', '094-inventory-cogs-on-invoice.sql'), 'utf8');
    // ربط البند بالصنف + مستهلك مخزون ذري
    expect(cogs).toContain('ADD COLUMN IF NOT EXISTS inventory_item_id UUID REFERENCES inventory_items(id)');
    expect(cogs).toContain('CREATE OR REPLACE FUNCTION public.consume_invoice_stock_internal(');
    // نفس قفل حركات المخزون الذري + قفل الصف + منع السالب
    expect(cogs).toContain("pg_advisory_xact_lock(hashtextextended('inventory-stock:'||p_company_id::TEXT||':'||lower(v_inv_item.code),0))");
    expect(cogs).toContain('COALESCE(v_inv_item.quantity, 0) + 0.005 < v_qty');
    // قيد التكلفة 5100/1170 مرجعه invoice_cogs + الحركة مرجعها الفاتورة
    expect(cogs).toContain("code = '1170'");
    expect(cogs).toContain("reference_type = 'invoice_cogs'");
    expect(cogs).toContain("'issue',\n      v_qty, v_cost, v_value");
    // الإنشاء يخزن الرابط ويستهلك داخل نفس المعاملة
    expect(cogs).toContain("(NULLIF(COALESCE(v_item->>'inventory_item_id', ''), ''))::UUID");
    expect(cogs).toContain('PERFORM consume_invoice_stock_internal(');
    // الإلغاء يعكس قيد التكلفة ويعيد الكميات كحركة return بتكلفة الصرف الأصلية
    expect(cogs).toContain("reference_type = 'invoice_cogs'");
    expect(cogs).toContain("'invoice_cogs_reversal', p_invoice_id");
    expect(cogs).toContain("'invoice_cancellation'");
    expect(cogs).toContain('v_issue.unit_price');
  });

  test('ميجريشن 095 — قيمة متبقية واستبعاد ببيع بربح/خسارة', () => {
    const fa = fs.readFileSync(path.join(process.cwd(), 'src', 'migrations', '095-asset-salvage-and-disposal-sale.sql'), 'utf8');
    // الأعمدة الأربعة
    expect(fa).toContain('ADD COLUMN IF NOT EXISTS salvage_value NUMERIC(15,2) NOT NULL DEFAULT 0');
    expect(fa).toContain('ADD COLUMN IF NOT EXISTS sale_price NUMERIC(15,2)');
    expect(fa).toContain('ADD COLUMN IF NOT EXISTS gain_loss NUMERIC(15,2)');
    // الإهلاك يتوقف عند المتبقي: الحد = التكلفة − المُهلك − المتبقي
    expect(fa).toContain('purchase_cost - COALESCE(v_asset.accumulated_depreciation,0) - COALESCE(v_asset.salvage_value,0)');
    expect(fa).toContain('p_salvage_value>=p_purchase_cost');
    // الشطب: قيد (مجمع + خسارة) مقابل التكلفة — بلا منع للاستبعاد
    expect(fa).toContain("reference_type='fixed_asset_disposal'");
    expect(fa).not.toContain('لا يمكن استبعاد أصل له إهلاك');
    // البيع: تحصيل/مجمع/خسارة مقابل الأصل + ربح، مرجع dispose_sale
    expect(fa).toContain("reference_type='fixed_asset_disposal_sale'");
    expect(fa).toContain("'accountId',v_loss,'debit',-v_diff");
    expect(fa).toContain("'accountId',v_gain,'debit',0,'credit',v_diff");
    // إنشاء بقيمة متبقية (حملة جديدة)
    expect(fa).toContain('p_salvage_value NUMERIC DEFAULT 0');
  });

  test('ميجريشن 096 — التأمينات الاجتماعية ومستحقات نهاية الخدمة', () => {
    const pr = fs.readFileSync(path.join(process.cwd(), 'src', 'migrations', '096-gosi-and-eosb.sql'), 'utf8');
    // أعمدة GOSI + الحسابات
    expect(pr).toContain('ADD COLUMN IF NOT EXISTS gosi_employer NUMERIC(15,2) NOT NULL DEFAULT 0');
    expect(pr).toContain("('2155', 'مستحقات التأمينات الاجتماعية', 'liability')");
    // معادلة القيد: مدين 5210+5230 مقابل دائن 2140+2155+1160
    expect(pr).toContain("code='5230'");
    expect(pr).toContain("code='2155'");
    expect(pr).toContain("ROUND(v_total_salary-v_total_advance-v_total_gosi_employee,2)");
    expect(pr).toContain("'حصص التأمينات الاجتماعية (موظف + صاحب عمل)'");
    // النسب من الإعدادات مع سقف منطقي
    expect(pr).toContain("key='gosi_employer_rate'");
    expect(pr).toContain('v_gosi_employer_rate>1 THEN v_gosi_employer_rate:=0.1175');
    // EOSB: جدول فريد (شركة، موظف، شهر) + معادلة النصف/الشهر الكامل
    expect(pr).toContain('UNIQUE(company_id, employee_id, date)');
    expect(pr).toContain("v_factor:=CASE WHEN v_emp.years>=5 THEN 1.0 ELSE 0.5 END");
    expect(pr).toContain("v_amount:=ROUND(v_emp.salary*v_factor/12,2)");
    expect(pr).toContain("reference_type='eosb_accrual'");
    // منع الاستحقاق قبل التعيين وبعد نهاية الشهر
    expect(pr).toContain('e.hire_date<=v_month_end');
    expect(pr).toContain("p_month_date<>date_trunc('month',p_month_date)::DATE");
  });

  test('ميجريشن 097 — العملات المتعددة وفروق العملة المحققة (IAS 21)', () => {
    const fx = fs.readFileSync(path.join(process.cwd(), 'src', 'migrations', '097-multicurrency-ias21.sql'), 'utf8');
    // أعمدة المستندات + حسابا الفروق
    expect(fx).toContain('ALTER TABLE invoices ADD COLUMN IF NOT EXISTS currency_code TEXT');
    expect(fx).toContain('ALTER TABLE voucher_receipts ADD COLUMN IF NOT EXISTS exchange_rate NUMERIC(15,6) DEFAULT 1');
    expect(fx).toContain("('4210', 'أرباح فروق العملة', 'revenue')");
    expect(fx).toContain("('5450', 'خسائر فروق العملة', 'expense')");
    // الفاتورة: عملة + سعر تاريخي + وسم سطور القيد
    expect(fx).toContain('p_currency_code TEXT DEFAULT NULL');
    expect(fx).toContain('currency_id = v_currency_id, exchange_rate = v_rate');
    // معادلة الفرق المحقق في السند (الإنشاء والاعتماد)
    expect((fx.match(/v_alloc\*\(p_exchange_rate-COALESCE\(v_invoice\.exchange_rate,1\)\)\/p_exchange_rate/g) || []).length).toBe(1);
    expect((fx.match(/v_link\.amount\*\(v_receipt\.exchange_rate-COALESCE\(v_invoice\.exchange_rate,1\)\)\/v_receipt\.exchange_rate/g) || []).length).toBe(1);
    // الذمم تُخصم بسعر الفاتورة والفرق يذهب لـ4210/5450
    expect(fx).toContain("ROUND((p_amount-v_alloc_total)+v_relief_total,2)");
    expect(fx).toContain("ROUND((v_receipt.amount-v_link_total)+v_relief_total,2)");
    expect(fx).toContain("'accountId',v_fx_gain,'debit',0,'credit',v_fx_total");
    expect(fx).toContain("'accountId',v_fx_loss,'debit',-v_fx_total,'credit',0");
    // رفض سعر صرف غير موجب
    expect((fx.match(/سعر الصرف غير صالح/g) || []).length).toBeGreaterThanOrEqual(3);
  });
});
