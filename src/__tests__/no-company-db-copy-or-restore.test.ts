/**
 * Regression guard: لا "نسخة قاعدة بيانات" لأي عميل ولا أي سبيل لاستعادة
 * بيانات من ملفات — سياسة منصة دائمة.
 *
 * ما يتحقق منه هذا الملف:
 *  1. مسارات تصدير/استعادة JSON (company/data-export, backup/*) لم تعد
 *     موجودة على الإطلاق في شجرة API.
 *  2. ميجريشن 089 يحذف جداول الخدمة (company_data_exports, backup_logs).
 *  3. مصدر التطبيق لا يحتوي أي استيراد لمكتبات النسخ المحذوفة.
 *  4. التصدير الوحيد المتبقي (export-download) يقبل Excel/CSV فقط.
 *  5. لا يوجد أي مسار "استيراد جداول" للعملاء (رفع بيانات يعاد إدخالها
 *     يدوياً فقط) — عمليات الرفع المتبقية للعملاء هي الصور/الشعارات فقط.
 */
import fs from 'node:fs';
import path from 'node:path';

const root = process.cwd();
const read = (file: string) => fs.readFileSync(path.join(root, file), 'utf8');

function listRoutes(dir = 'src/app/api'): string[] {
  const out: string[] = [];
  const full = path.join(root, dir);
  for (const entry of fs.readdirSync(full, { withFileTypes: true })) {
    const child = path.join(dir, entry.name);
    if (entry.isDirectory()) out.push(...listRoutes(child));
    else if (entry.name === 'route.ts') out.push(child.replace(/\\/g, '/').replace(/^src\/app\/api\//, '').replace(/\/route\.ts$/, ''));
  }
  return out;
}

describe('no client-facing database copy or restore exists', () => {
  test('the JSON export and backup/restore API routes are gone for good', () => {
    const routes = listRoutes();
    // The route inventory must be real, or the assertions below are vacuous.
    expect(routes.length).toBeGreaterThan(150);
    const forbidden = [
      'company/data-export',
      'company/data-export/[id]/download',
      'backup/download',
      'backup/upload',
      'backup/validate',
      'backup/auto',
    ];
    expect(routes.filter((route) => forbidden.includes(route))).toEqual([]);
    // And the whole backup subtree must not have crept back in any shape.
    expect(routes.filter((route) => route.startsWith('backup'))).toEqual([]);
  });

  test('migration 089 drops the tables that served the removed feature', () => {
    const migration = read('src/migrations/089-remove-company-db-copy-and-restore.sql');
    expect(migration).toContain('DROP TABLE IF EXISTS company_data_exports;');
    expect(migration).toContain('DROP TABLE IF EXISTS backup_logs;');
    expect(migration).toContain("bucket_id = 'company-exports'");
  });

  test('the removed backup libraries are not imported anywhere in src', () => {
    const walk = (dir: string): string[] => fs.readdirSync(path.join(root, dir), { withFileTypes: true })
      .flatMap((entry) => {
        const full = path.join(dir, entry.name);
        if (entry.isDirectory()) return walk(full);
        return /\.(ts|tsx)$/.test(entry.name) ? [full] : [];
      });
    const offenders = walk('src').filter((file) => {
      if (file.includes('__tests__')) return false; // tests may name the dead paths
      const src = read(file);
      return /backup-integrity|backup-validation/.test(src)
        || /['"]\/api\/(company\/data-export|backup\/)/.test(src);
    });
    // backup-retention stays: it is pure logic for the DEVELOPER's global
    // pg_dump backups (scripts/global-backup.ts), never exposed to clients.
    expect(offenders).toEqual([]);
  });

  test('the surviving table export only ever emits Excel or CSV', () => {
    const route = read('src/app/api/company/export-download/route.ts');
    expect(route).toContain("new Set(['csv', 'excel'])");
    expect(route).not.toMatch(/'json'|application\/json/);
    expect(route).toContain('EXPORT_TABLES');
  });

  test('no client route accepts a data-file upload (payment receipts go via Telegram now)', () => {
    const routes = listRoutes('src/app/api');
    const uploadRoutes = routes.filter((route) => route.startsWith('upload'));
    // Payment-receipt uploads were removed: proof screenshots are sent to the
    // developer on Telegram. There is no file-upload surface at all.
    expect(uploadRoutes).toEqual([]);
  });
});
