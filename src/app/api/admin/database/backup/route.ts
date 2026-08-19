import { NextRequest } from 'next/server';
import { success, error } from '@/lib/api-helpers';
import { requireAdmin, adminJsonError } from '@/lib/admin-guard';
import { verifyMasterPassword, auditLog } from '@/lib/admin-auth';
import { sendAdminNotification, escapeTelegramHtml } from '@/lib/telegram';

// SECURITY: Database backup is a privileged action. It now requires the master
// password on every call AND never returns raw data to the client. A real
// backup must be taken through Supabase dashboard / pg_dump — this endpoint
// only records an audit entry and optionally notifies the admin.
export async function POST(request: NextRequest) {
  try {
    const admin = await requireAdmin(request);
    const body = await request.json().catch(() => ({})) as { masterPassword?: string };
    if (!body.masterPassword) {
      return error('كلمة المرور الرئيسية مطلوبة', 401);
    }
    const valid = await verifyMasterPassword(admin.adminId, String(body.masterPassword));
    if (!valid) {
      return error('كلمة المرور الرئيسية غير صحيحة', 401);
    }

    await sendAdminNotification(
      `💾 طلب نسخ احتياطي من لوحة التحكم\nبواسطة: ${escapeTelegramHtml(admin.email)}`
    ).catch(() => {});

    await auditLog(admin.adminId, 'backup_requested', 'Admin requested a database backup (manual via Supabase required)');

    return success({
      message: 'لتأمين قاعدة البيانات، استخدم أداة النسخ الاحتياطي في لوحة تحكم Supabase أو pg_dump. تم تسجيل الطلب في السجلات.',
    });
  } catch (err) {
    return adminJsonError(err);
  }
}
