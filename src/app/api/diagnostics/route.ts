import { success } from '@/lib/api-helpers';
import { getSupabase } from '@/lib/supabase-client';

/**
 * GET /api/diagnostics
 * نقطة تشخيص ذاتية عامة (لا تكشف أسراراً ولا بيانات، فقط حالة جاهزية النظام).
 * تجيب مباشرة على سؤال: "لماذا تسجيل الدخول 401؟ لماذا الفواتير 500؟"
 * - تحقق من متغيرات البيئة (وجودها فقط، بدون قيمها)
 * - اتصال قاعدة البيانات
 * - الجداول والأعمدة المحورية (انحراف المخطط / هجرات ناقصة)
 * - دوال RPC المطلوبة
 * - عدد المستخدمين (قاعدة فارغة = تسجيل دخول سيفشل دائماً)
 */
export async function GET() {
  const report: Record<string, any> = {
    ok: true,
    deployment: {
      commit: process.env.VERCEL_GIT_COMMIT_SHA || null,
      nodeEnv: process.env.NODE_ENV || null,
    },
    env: {
      NEXT_PUBLIC_SUPABASE_URL: Boolean(process.env.NEXT_PUBLIC_SUPABASE_URL),
      SUPABASE_SERVICE_ROLE_KEY: Boolean(process.env.SUPABASE_SERVICE_ROLE_KEY),
      TOKEN_SECRET: Boolean(process.env.TOKEN_SECRET),
    },
    db: { connected: false as boolean, error: null as string | null },
    tables: {} as Record<string, 'ok' | 'missing' | 'error'>,
    columns: {} as Record<string, 'ok' | 'missing' | 'error'>,
    functions: {} as Record<string, 'ok' | 'missing' | 'unknown'>,
    usersCount: null as number | null,
    issues: [] as string[],
  };

  const missingEnv = Object.entries(report.env).filter(([, v]) => !v).map(([k]) => k);
  if (missingEnv.length > 0) {
    report.ok = false;
    report.issues.push(`متغيرات بيئة ناقصة: ${missingEnv.join(', ')}`);
  }

  let s: any;
  try {
    s = getSupabase();
  } catch (e: any) {
    report.ok = false;
    report.db.error = e?.message || 'فشل إنشاء عميل Supabase';
    report.issues.push('تعذر إنشاء اتصال Supabase — تحقق من متغيرات البيئة');
    return success(report);
  }

  try {
    const { error } = await s.from('companies').select('id', { head: true, count: 'exact' }).limit(1);
    if (error && !/does not exist|Could not find/i.test(error.message || '')) {
      report.db.error = error.message;
    }
    report.db.connected = !error || !/fetch|network|ECONN|ENOTFOUND/i.test(error.message || '');
  } catch (e: any) {
    report.db.error = e?.message || 'fetch failed';
    report.ok = false;
    report.issues.push(`فشل الاتصال بقاعدة البيانات: ${e?.message}`);
  }

  const isMissing = (err: any, name: string) =>
    !!err && new RegExp(`${name}|does not exist|Could not find|42P01|42703`, 'i').test(`${err.message || ''} ${err.details || ''} ${err.code || ''}`);

  const coreTables = ['companies', 'users', 'accounts', 'contacts', 'journal_entries', 'journal_lines', 'invoice_sequences', 'journal_sequences', 'invoices', 'invoice_items', 'banks_safes', 'voucher_receipts', 'login_attempts'];
  for (const table of coreTables) {
    try {
      const { error } = await s.from(table).select('id', { head: true }).limit(1);
      report.tables[table] = !error ? 'ok' : isMissing(error, table) ? 'missing' : 'error';
    } catch {
      report.tables[table] = 'error';
    }
    if (report.tables[table] === 'missing') {
      report.ok = false;
      report.issues.push(`الجدول ${table} غير موجود — شغّل الهجرات: npm run migrate`);
    }
  }

  const columnChecks: Record<string, string[]> = {
    invoices: ['deleted_at', 'paid_amount', 'journal_entry_id', 'zatca_qr', 'project_id'],
    journal_lines: ['company_id', 'contact_id'],
    users: ['is_active', 'email_verified'],
    companies: ['is_active'],
    banks_safes: ['account_id'],
  };
  for (const [table, cols] of Object.entries(columnChecks)) {
    if (report.tables[table] !== 'ok') continue;
    for (const col of cols) {
      const key = `${table}.${col}`;
      try {
        const { error } = await s.from(table).select(col, { head: true }).limit(1);
        report.columns[key] = !error ? 'ok' : isMissing(error, col) ? 'missing' : 'error';
      } catch {
        report.columns[key] = 'error';
      }
      if (report.columns[key] === 'missing') {
        report.ok = false;
        report.issues.push(`العمود ${key} غير موجود — هجرة ناقصة (راجع src/migrations)`);
      }
    }
  }

  // كشف وجود الدوال بأمان تام: نستدعيها بمعطيات بنوع خاطئ فيفشل تحليل النوع
  // قبل تنفيذ جسم الدالة (لا آثار جانبية). إن لم توجد الدالة ⇒ PGRST "Could not find".
  const probeFn = async (name: string, args: Record<string, any>) => {
    try {
      const { error } = await s.rpc(name, args);
      report.functions[name] = !error ? 'ok' : /Could not find|PGRST202/i.test(error.message || '') ? 'missing' : 'ok';
    } catch (e: any) {
      report.functions[name] = /Could not find|PGRST202/i.test(e?.message || '') ? 'missing' : 'unknown';
    }
    if (report.functions[name] === 'missing') {
      report.issues.push(`الدالة ${name} غير موجودة في قاعدة البيانات — طبّق الهجرات (مثل 012)`);
    }
  };
  await probeFn('create_journal_entry', { p_company_id: 'x', p_date: 'x', p_type: 'x', p_description: 'x', p_created_by: 'x', p_lines: 'x' });
  await probeFn('next_invoice_number', { p_company_id: 'x', p_year: 'x' });
  await probeFn('next_journal_number', { p_company_id: 'x', p_year: 'x' });

  try {
    const { count } = await s.from('users').select('id', { head: true, count: 'exact' });
    report.usersCount = count ?? 0;
    if ((count ?? 0) === 0) {
      report.ok = false;
      report.issues.push('لا يوجد أي مستخدم في قاعدة البيانات — لذلك يفشل تسجيل الدخول دائماً (401). سجّل شركة جديدة من صفحة التسجيل أو أعد تشغيل البذر.');
    }
  } catch { /* ignore */ }

  if (report.issues.length === 0) {
    report.issues.push('كل الفحوصات سليمة — إن استمرت المشكلة فراجع سجلات الخادم');
  }

  return success(report);
}
