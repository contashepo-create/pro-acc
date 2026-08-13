import { NextRequest, NextResponse } from 'next/server';
import { success, error, serverError, parseBody } from '@/lib/api-helpers';
import { applyCacheHeaders } from '@/lib/cache';
import { hashPassword, verifyPassword } from '@/lib/auth';
import { getSupabase } from '@/lib/supabase-client';

const sb = () => getSupabase();

const MIN_PASSWORD_LENGTH = 8;

export async function GET(request: NextRequest) {
  try {
    // Use requireApiAuth so user+company state (is_active, token_version, etc.)
    // is validated consistently with the rest of the API. skipModuleGuard lets
    // expired users still load their profile (needed for the password-reset/
    // support flows after expiry).
    const { requireApiAuth } = await import('@/lib/api-helpers');
    let auth;
    try {
      auth = await requireApiAuth(request, { skipModuleGuard: true });
    } catch {
      const resp = error('Unauthorized', 401);
      applyCacheHeaders(resp, { cache: 'no-store' });
      return resp;
    }

    const s = sb();
    const { data: user, error: userErr } = await s.from('users')
      .select('id, name, email, role, is_active, last_login, company_id, created_at')
      .eq('id', auth.userId).single();

    if (userErr || !user) {
      const resp = error('المستخدم غير موجود', 404);
      applyCacheHeaders(resp, { cache: 'no-store' });
      return resp;
    }
    const u = user as Record<string, any>;

    const { data: company } = await s.from('companies')
      .select('id, name, commercial_registration, tax_number, address, phone, email, is_active')
      .eq('id', auth.companyId).maybeSingle();
    const c = company as Record<string, any> | null;

    const resp = success({
      user: {
        id: u.id, name: u.name, email: u.email, role: u.role,
        isActive: u.is_active, lastLogin: u.last_login, createdAt: u.created_at,
      },
      company: c || null,
    });
    applyCacheHeaders(resp, { cache: 'no-store' });
    return resp;
  } catch (err) {
    return serverError(err);
  }
}

/**
 * PUT /api/auth/me
 * تحديث الملف الشخصي (الاسم) أو تغيير كلمة المرور.
 * يعيد النتيجة بتنسيق موحّد: { success, message, user? } مباشرة في جذر الـ JSON.
 * مسموح حتى عند انتهاء الاشتراك (whitelisted في subscription-guard) حتى يتمكن
 * المستخدم من تغيير كلمة مروره أو التواصل مع الدعم.
 */
export async function PUT(request: NextRequest) {
  try {
    const { requireApiAuth } = await import('@/lib/api-helpers');
    let auth;
    try {
      auth = await requireApiAuth(request, { skipModuleGuard: true });
    } catch {
      return error('غير مصرح به', 401);
    }

    const s = sb();
    const { data: user, error: userErr } = await s.from('users')
      .select('id, name, email, password_hash, token_version, is_active')
      .eq('id', auth.userId).single();

    if (userErr || !user) return error('المستخدم غير موجود', 404);
    const u = user as Record<string, any>;
    if (!u.is_active) return error('هذا الحساب غير نشط', 403);

    const storedVersion = Number(u.token_version) || 0;
    const body = await parseBody<{
      name?: string; email?: string;
      old_password?: string; new_password?: string;
    }>(request);

    // تغيير كلمة المرور
    if (body.old_password || body.new_password) {
      if (!body.old_password || !body.new_password) {
        return error('يجب إدخال كلمة المرور الحالية والجديدة');
      }
      if (!u.password_hash || !(await verifyPassword(String(body.old_password), u.password_hash))) {
        return error('كلمة المرور الحالية غير صحيحة');
      }
      if (String(body.new_password).length < MIN_PASSWORD_LENGTH) {
        return error(`كلمة المرور الجديدة يجب أن تكون ${MIN_PASSWORD_LENGTH} أحرف على الأقل`);
      }

      const newHash = await hashPassword(String(body.new_password));
      const nextVersion = storedVersion + 1;
      const { error: updErr } = await s.from('users')
        .update({ password_hash: newHash, token_version: nextVersion, updated_at: new Date().toISOString() })
        .eq('id', u.id);
      if (updErr) {
        console.error('[auth/me PUT] failed to update password', updErr);
        throw updErr;
      }

      return NextResponse.json(
        { success: true, message: 'تم تغيير كلمة المرور بنجاح — سجّل الدخول مجدداً' },
        { status: 200, headers: { 'Cache-Control': 'no-store, no-cache, must-revalidate, private' } }
      );
    }

    // تحديث بيانات الملف الشخصي (الاسم والبريد)
    const update: Record<string, unknown> = { updated_at: new Date().toISOString() };
    if (typeof body.name === 'string' && body.name.trim()) update.name = body.name.trim();
    if (typeof body.email === 'string' && body.email.trim() && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(body.email.trim())) {
      update.email = body.email.trim().toLowerCase();
    }

    const { data: updated, error: updErr } = await s.from('users')
      .update(update)
      .eq('id', u.id)
      .select('id, name, email, role, is_active')
      .single();
    if (updErr) {
      console.error('[auth/me PUT] failed to update profile', updErr);
      throw updErr;
    }

    const uu = updated as Record<string, any>;
    const safeUser = { id: uu.id, name: uu.name, email: uu.email, role: uu.role, isActive: uu.is_active };

    return NextResponse.json(
      { success: true, message: 'تم حفظ البيانات بنجاح', user: safeUser },
      { status: 200, headers: { 'Cache-Control': 'no-store, no-cache, must-revalidate, private' } }
    );
  } catch (err) {
    return serverError(err);
  }
}
