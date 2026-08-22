import { NextRequest } from 'next/server';
import { success, error, parseBody, setAuthCookie, clearAuthCookie } from '@/lib/api-helpers';
import { verifyPassword, createAdminToken } from '@/lib/auth';
import { getSession, deleteSession, parseAdminSessionPointer } from '@/lib/admin-session';
import { getSupabase } from '@/lib/supabase-client';
import { adminJsonError } from '@/lib/admin-guard';
import { auditLog } from '@/lib/admin-auth';

const sb = () => getSupabase();

export async function POST(request: NextRequest) {
  try {
    const { email, masterPassword } = await parseBody<{ email: string; masterPassword: string }>(request);

    if (!email || !masterPassword) {
      return error('البريد الإلكتروني وكلمة المرور الرئيسية مطلوبة');
    }

    const adminId = request.cookies.get('admin_session')?.value;
    const pointer = adminId ? parseAdminSessionPointer(adminId) : null;
    if (!adminId || !pointer) {
      return error('انتهت صلاحية الجلسة. يرجى تسجيل الدخول مرة أخرى', 401);
    }

    const session = await getSession(adminId);
    if (!session) {
      return error('انتهت صلاحية الجلسة. يرجى تسجيل الدخول مرة أخرى', 401);
    }

    if (session.email.toLowerCase() !== email.trim().toLowerCase()) {
      return error('البريد الإلكتروني غير متطابق مع الجلسة', 401);
    }

    if (session.step !== 'telegram_verified') {
      return error('يرجى التحقق من رمز تيليجرام أولاً', 401);
    }

    const { checkRateLimit } = await import('@/lib/rate-limit');
    const ip = request.headers.get('x-forwarded-for')?.split(',')[0]?.trim() || 'unknown';
    const rateLimit = await checkRateLimit(session.email, ip);
    if (!rateLimit.allowed) return error('تم تجاوز عدد المحاولات. حاول لاحقاً', 429);

    const s = sb();
    const { data: admin, error: queryErr } = await s.from('admin_users')
      .select('id, name, email, master_password_hash, is_active, token_version')
      .eq('id', pointer.adminId)
      .eq('email', session.email)
      .single();

    if (queryErr || !admin) {
      return error('المستخدم غير موجود', 401);
    }

    const a = admin as Record<string, any>;
    if (!a.is_active) {
      return error('هذا الحساب غير نشط', 403);
    }

    if (!a.master_password_hash) {
      return error('لم يتم تعيين كلمة مرور رئيسية لهذا الحساب', 403);
    }

    const valid = await verifyPassword(masterPassword, a.master_password_hash);
    if (!valid) {
      const { error: attemptErr } = await s.from('login_attempts').insert({
        email: session.email,
        ip_address: ip,
        success: false,
        attempted_at: new Date().toISOString(),
      });
      if (attemptErr) throw attemptErr;
      return error('كلمة المرور الرئيسية غير صحيحة', 401);
    }

    // SECURITY: Use admin-specific secret; shorter TTL (24h); role enforced.
    const token = createAdminToken(a.id, Number(a.token_version) || 0);
    await deleteSession(adminId);
    try { await auditLog(a.id, 'admin_login_success', 'Admin login successful (step 3)'); } catch {}

    // SECURITY: the admin session JWT travels only in the HttpOnly
    // admin_token cookie — never in the JSON body (XSS could read a body
    // token and fully neutralize the httpOnly protection).
    const response = success({
      message: 'تم تسجيل الدخول بنجاح',
      admin: { id: a.id, name: a.name, email: a.email, role: 'superadmin' },
    });

    setAuthCookie(response, 'admin_token', token, 86400);
    clearAuthCookie(response, 'admin_session');

    return response;
  } catch (err) {
    return adminJsonError(err);
  }
}
