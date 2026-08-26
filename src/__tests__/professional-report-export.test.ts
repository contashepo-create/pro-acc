/**
 * اختبارات التصدير الاحترافي — تقارير محاسبية بدل النسخ الخام:
 *  - أعمدة عربية واضحة، أسماء حقيقية بدل المعرّفات، حالات مترجمة.
 *  - لا جداول حساسة (settings/notifications/users) ولا أعمدة تقنية.
 *  - تنسيق المبالغ والتواريخ وصلاحيات الشركات.
 *  - حارس تباين الألوان: لا نصوص شفافة منخفضة التباين في لوحة المطور
 *    وتنبيه الاشتراك.
 */
process.env.TOKEN_SECRET = 'test-secret-key-for-unit-tests-32chars!';
import fs from 'fs';
import path from 'path';

import {
  REPORTS, EXPORT_TABLES, LEGACY_TABLE_ALIAS, resolveReportIds, getReport,
  buildLookupMaps, shapeReportRow, shapeReportHeaders,
} from '@/lib/report-export';

const root = process.cwd();
const read = (f: string) => fs.readFileSync(path.join(root, f), 'utf8');

describe('مواصفات التقارير الاحترافية', () => {
  test('كل تقرير له عنوان عريبي وأعمدة بعناوين عربية', () => {
    for (const spec of REPORTS) {
      expect(spec.title.trim().length).toBeGreaterThan(2);
      expect(spec.columns.length).toBeGreaterThan(0);
      for (const col of spec.columns) {
        expect(col.label.trim().length).toBeGreaterThan(1);
      }
    }
  });

  test('لا جداول حساسة أو داخلية في التقارير نهائياً', () => {
    const forbidden = ['settings', 'notifications', 'users', 'audit_log', 'login_attempts', 'admin_users'];
    for (const f of forbidden) expect(EXPORT_TABLES).not.toContain(f);
  });

  test('الأسماء القديمة الخام تُحوَّل إلى تقاريرها الاحترافية', () => {
    expect(resolveReportIds(['clients'])).toEqual(['contacts']);
    expect(resolveReportIds(['inventory'])).toEqual(['inventory_items']);
    expect(resolveReportIds(['banks'])).toEqual(['banks_safes']);
    expect(resolveReportIds(['vouchers'])).toEqual(['voucher_receipts']);
    expect(resolveReportIds(['journal_lines'])).toEqual(['journal_entries']);
    expect(resolveReportIds(['settings'])).toEqual([]);
    expect(LEGACY_TABLE_ALIAS['users']).toBeUndefined();
  });

  test('تقرير فواتير المبيعات: أسماء حقيقية وحالات مترجمة ومتبقي محسوب', () => {
    const spec = getReport('invoices')!;
    const maps = buildLookupMaps({
      contacts: [{ id: 'c1', name: 'شركة الأهرام' }],
      projects: [{ id: 'p1', name: 'برج الرياض' }],
    });
    const row = {
      number: 12, date: '2026-02-01T00:00:00Z', due_date: '2026-03-01', contact_id: 'c1',
      project_id: 'p1', subtotal: 1000, tax_amount: 150, total: 1150, paid_amount: 400, status: 'partial',
    };
    const rec = shapeReportRow(spec, row, maps);
    const headers = shapeReportHeaders(spec);
    expect(headers).toContain('العميل');
    expect(headers).toContain('المتبقي');
    expect(rec[headers.indexOf('العميل')]).toBe('شركة الأهرام');
    expect(rec[headers.indexOf('المشروع')]).toBe('برج الرياض');
    expect(rec[headers.indexOf('المتبقي')]).toBe('750.00');
    expect(rec[headers.indexOf('الحالة')]).toBe('مدفوعة جزئياً');
    expect(rec[headers.indexOf('التاريخ')]).toBe('2026-02-01');
  });

  test('دفتر اليومية يعرض رقم القيد واسم الحساب دون معرفات تقنية', () => {
    const spec = getReport('journal_entries')!;
    const maps = buildLookupMaps({
      journal_entries: [{ id: 'je1', number: 55, date: '2026-01-15', description: 'فاتورة مبيعات #12' }],
    });
    const rec = shapeReportRow(spec, {
      id: 'jl-raw-uuid', journal_entry_id: 'je1', account_code: '4100',
      account_name: 'الإيرادات', description: 'سطر القيد', debit: 1150, credit: 0,
    }, maps);
    const headers = shapeReportHeaders(spec);
    expect(rec[headers.indexOf('رقم القيد')]).toBe('#55');
    expect(rec[headers.indexOf('بيان القيد')]).toBe('فاتورة مبيعات #12');
    expect(rec[headers.indexOf('اسم الحساب')]).toBe('الإيرادات');
    expect(rec.join(',')).not.toContain('jl-raw-uuid');
  });

  test('قيم المبالغ تُنسَّق برقمين عشريين والقيم المفقودة تصبح فارغة لا undefined', () => {
    const spec = getReport('invoices')!;
    const rec = shapeReportRow(spec, { number: 1, total: 99.5 }, buildLookupMaps({}));
    expect(rec.join(',')).not.toMatch(/undefined|null/i);
    expect(rec[spec.columns.findIndex((c) => c.label === 'الضريبة')]).toBe('');
  });
});

describe('حارس تباين الألوان — لوحة المطور وتنبيه الاشتراك', () => {
  const uiFiles = [
    'src/components/SubscriptionBanner.tsx',
    'src/app/zerocold/subscriptions/page.tsx',
    'src/app/zerocold/companies/page.tsx',
    'src/app/zerocold/plans/page.tsx',
    'src/app/zerocold/logs/page.tsx',
    'src/app/zerocold/layout.tsx',
    'src/app/zerocold/database/page.tsx',
  ];

  test('لا نصوص شفافة منخفضة التباين (400/70 أو 950/20) في الأزرار والتنبيهات', () => {
    for (const file of uiFiles) {
      const src = read(file);
      // نص بلون 60-70% شفافية = غير مقروء على الخلفيات الداكنة الشفافة
      expect({ file, has: /text-[a-z]+-400\/[5-7]0/.test(src) }).toEqual({ file, has: false });
      // خلفيات شبه مخفية 20% للأزرار الحساسة (تغيير باقة/تمديد/إلغاء)
      expect({ file, has: /bg-[a-z]+-950\/20[\s"']/.test(src) }).toEqual({ file, has: false });
    }
  });

  test('تنبيه الاشتراك المنتهي بخلفية صلبة ونص أبيض وأزرار فاتحة واضحة', () => {
    const src = read('src/components/SubscriptionBanner.tsx');
    expect(src).toContain('bg-red-600');
    expect(src).toContain('text-white');
    expect(src).toContain('bg-white text-red-700');
    // لا تبقى الخلفيات الشفافة القديمة غير المقروءة
    expect(src).not.toContain('bg-red-950/20');
    expect(src).not.toContain('text-red-300');
  });

  test('أزرار تغيير الباقة/التمديد/الإلغاء صلبة عالية التباين', () => {
    const src = read('src/app/zerocold/subscriptions/page.tsx');
    expect(src).toContain('bg-purple-600 text-white');
    expect(src).toContain('bg-emerald-600 text-white');
    expect(src).toContain('bg-red-600 text-white');
  });
});

describe('صفحة التصدير تعرض التقارير لا الجداول الخام', () => {
  test('الصفحة تستورد التقارير من المصدر الموحد ولا تعرض إعدادات/إشعارات', () => {
    const src = read('src/app/export-data/page.tsx');
    expect(src).toContain("from '@/lib/report-export'");
    expect(src).not.toContain("notifications: 'الإشعارات'");
    expect(src).not.toContain("settings: 'الإعدادات'");
    expect(src).toContain('تقارير محاسبية');
  });
});
