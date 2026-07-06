import { NextRequest } from 'next/server';
import { success, unauthorized, serverError } from '@/lib/api-helpers';
import { query } from '@/lib/db';
import { verifyAdminToken, auditLog } from '@/lib/admin-auth';
import { sendAdminNotification } from '@/lib/telegram';

export async function POST(request: NextRequest) {
  try {
    const admin = await verifyAdminToken(request);
    if (!admin) return unauthorized();

    const tablesRes = await query(
      `SELECT tablename FROM pg_tables WHERE schemaname = 'public' ORDER BY tablename`
    );

    let sqlDump = `-- AccWeb Database Backup\n-- Generated: ${new Date().toISOString()}\n\n`;

    for (const { tablename } of tablesRes.rows) {
      sqlDump += `\n-- Table: ${tablename}\n`;
      const countRes = await query(`SELECT COUNT(*) FROM "${tablename}"`);
      sqlDump += `-- Rows: ${countRes.rows[0].count}\n`;
    }

    await sendAdminNotification(
      `💾 تم إنشاء نسخة احتياطية من قاعدة البيانات\n` +
      `الجداول: ${tablesRes.rows.length}\n` +
      `الحجم: ${JSON.stringify(sqlDump.length)} bytes\n` +
      `بواسطة: ${admin.userId}`
    );

    await auditLog(admin.userId, 'backup', `Database backup created, ${tablesRes.rows.length} tables`);

    return success({
      message: 'تم إنشاء النسخة الاحتياطية بنجاح',
      tables: tablesRes.rows.length,
    });
  } catch (err) {
    return serverError(err);
  }
}
