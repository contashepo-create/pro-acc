import { NextRequest } from 'next/server';
import { error, parseBody } from '@/lib/api-helpers';
import { requireAdmin, adminJsonError } from '@/lib/admin-guard';
import { verifyMasterPassword, auditLog } from '@/lib/admin-auth';

// SECURITY: Restoring arbitrary SQL from a browser upload is RCE-class risk.
// The previous endpoint accepted files up to 50MB, split them on ';' and ran
// the statements against the DB. This endpoint is now CLOSED — it returns an
// error and logs the attempt. Restores must be performed via Supabase dashboard
// with a verified, signed backup file.
export async function POST(request: NextRequest) {
  try {
    const admin = await requireAdmin(request);
    const body = await parseBody<{ masterPassword?: string }>(request);
    if (!body.masterPassword) return error('كلمة المرور الرئيسية مطلوبة', 401);
    const valid = await verifyMasterPassword(admin.adminId, String(body.masterPassword));
    if (!valid) return error('كلمة المرور الرئيسية غير صحيحة', 401);

    await auditLog(admin.adminId, 'restore_attempt_blocked', 'Blocked web-based DB restore attempt — restore must be performed via Supabase dashboard');

    return error('استعادة قاعدة البيانات عبر الويب معطلة لأسباب أمنية. استخدم لوحة تحكم Supabase مع ملف نسخة احتياطية موثّق.', 403);
  } catch (err) {
    return adminJsonError(err);
  }
}
