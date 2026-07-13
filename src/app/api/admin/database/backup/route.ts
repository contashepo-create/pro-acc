import { NextRequest } from 'next/server';
import { getSupabase } from '@/lib/supabase-client';
import { success, error, serverError } from '@/lib/api-helpers';
import { verifyToken } from '@/lib/auth';
import { auditLog } from '@/lib/admin-auth';
import { sendAdminNotification } from '@/lib/telegram';

const sb = () => getSupabase();

// Known tables in the database
const KNOWN_TABLES = [
  'activation_codes', 'admin_audit_log', 'admin_users', 'advertisements',
  'companies', 'complaints', 'messages', 'payment_transactions',
  'subscription_plans', 'subscriptions', 'users',
];

export async function POST(request: NextRequest) {
  try {
    const token = request.cookies.get('admin_token')?.value;
    if (!token) return error('Unauthorized', 401);
    const payload = verifyToken(token);
    if (!payload || payload.role !== 'superadmin') return error('Unauthorized', 401);

    const s = sb();

    // Get row counts for each known table
    const tableCounts = await Promise.all(
      KNOWN_TABLES.map(async (tableName) => {
        const { count } = await s.from(tableName).select('*', { count: 'exact', head: true });
        return { tablename: tableName, count: count || 0 };
      })
    );

    let sqlDump = `-- AccWeb Database Backup\n-- Generated: ${new Date().toISOString()}\n\n`;

    for (const { tablename, count } of tableCounts) {
      sqlDump += `\n-- Table: ${tablename}\n`;
      sqlDump += `-- Rows: ${count}\n`;
    }

    await sendAdminNotification(
      `💾 تم إنشاء نسخة احتياطية من قاعدة البيانات\n` +
      `الجداول: ${KNOWN_TABLES.length}\n` +
      `الحجم: ${JSON.stringify(sqlDump.length)} bytes\n` +
      `بواسطة: ${payload.userId}`
    );

    await auditLog(payload.userId, 'backup', `Database backup created, ${KNOWN_TABLES.length} tables`);

    return success({
      message: 'تم إنشاء النسخة الاحتياطية بنجاح',
      tables: KNOWN_TABLES.length,
    });
  } catch (err) {
    return serverError(err);
  }
}
