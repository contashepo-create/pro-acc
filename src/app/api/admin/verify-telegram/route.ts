import { NextRequest } from 'next/server';
import { success, error, serverError, parseBody } from '@/lib/api-helpers';
import { parseAdminSessionPointer } from '@/lib/admin-session';
import { auditLog } from '@/lib/admin-auth';
import { createHash } from 'crypto';
import { getSupabase } from '@/lib/supabase-client';

import type { Row } from '@/lib/types';

export async function POST(request: NextRequest) {
  try {
    const { email, code } = await parseBody<{ email: string; code: string }>(request);
    if (!email || typeof email !== 'string') return error('البريد الإلكتروني مطلوب');
    if (!code || typeof code !== 'string' || !/^\d{6}$/.test(code)) return error('رمز التحقق غير صالح');

    const sessionCookie = request.cookies.get('admin_session')?.value || '';
    const pointer = parseAdminSessionPointer(sessionCookie);
    if (!pointer) return error('جلسة غير صالحة', 401);

    // The row lock, attempt increment and one-time state transition happen in
    // one transaction. Parallel guesses cannot lose increments or both pass.
    const { data, error: verifyErr } = await getSupabase().rpc('verify_admin_login_otp', {
      p_admin_id: pointer.adminId,
      p_session_id: pointer.sessionId,
      p_email: email.trim().toLowerCase(),
      p_code_hash: createHash('sha256').update(code).digest('hex'),
    });
    if (verifyErr) throw verifyErr;
    const status = String((data as Row)?.status || 'invalid_session');
    if (status === 'locked') return error('تم تجاوز عدد محاولات رمز التحقق. يرجى تسجيل الدخول مجدداً', 429);
    if (status === 'invalid_code') return error('رمز التحقق غير صحيح', 401);
    if (status !== 'verified') return error('رمز التحقق منتهي الصلاحية أو حالة الجلسة غير صالحة', 401);

    try { await auditLog(pointer.adminId, 'admin_login_step2', 'Telegram 2FA verified'); } catch {}
    return success({ message: 'تم التحقق من رمز تيليجرام بنجاح' });
  } catch (err) {
    return serverError(err);
  }
}
