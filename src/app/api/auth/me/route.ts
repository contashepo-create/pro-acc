import { NextRequest } from 'next/server';
import { success, error, unauthorized, serverError, notFound } from '@/lib/api-helpers';
import { verifyToken, extractToken, hashPassword, verifyPassword } from '@/lib/auth';
import { getSupabase } from '@/lib/supabase-client';

const sb = () => getSupabase();

export async function GET(request: NextRequest) {
  try {
    const token = extractToken(request);
    if (!token) {
      // No token at all → user simply isn't logged in; expected on public pages.
      return unauthorized();
    }

    const payload = verifyToken(token);
    if (!payload) {
      // Token present but rejected: wrong TOKEN_SECRET between deployments,
      // expired (7 days), or tampered. Log so a flood of 401s is diagnosable.
      console.warn('[auth/me] 401: token rejected — تحقق من ثبات TOKEN_SECRET بين عمليات النشر أو انتهاء صلاحية التوكن (7 أيام)');
      return unauthorized();
    }

    const s = sb();

    const { data: user, error: userErr } = await s.from('users')
      .select('id, name, email, role, is_active, last_login, company_id, created_at, token_version')
      .eq('id', payload.userId).single();

    if (userErr || !user) return notFound();
    const u = user as Record<string, any>;
    if (!u.is_active) return error('هذا الحساب غير نشط', 403);

    // SECURITY: Reject stale tokens (issued before logout / password change).
    const storedVersion = Number(u.token_version) || 0;
    if (payload.ver !== storedVersion) return unauthorized();

    const { data: company } = await s.from('companies')
      .select('id, name, commercial_registration, tax_number, address, phone, email, is_active')
      .eq('id', u.company_id).single();
    const c = company as Record<string, any>;

    return success({
      user: {
        id: u.id, name: u.name, email: u.email, role: u.role,
        isActive: u.is_active, lastLogin: u.last_login, createdAt: u.created_at,
      },
      company: c || null,
    });
  } catch (err) {
    return serverError(err);
  }
}

/**
 * PUT /api/auth/me
 * تحديث الملف الشخصي (الاسم) أو تغيير كلمة المرور.
 * كان زر حفظ الملف/كلمة المرور في صفحة الملف الشخصي يستدعي PUT على مسار
 * يملك GET فقط، فكان التحديث يفشل دائماً.
 */
export async function PUT(request: NextRequest) {
  try {
    const token = extractToken(request);
    if (!token) return unauthorized();
    const payload = verifyToken(token);
    if (!payload) return unauthorized();

    const s = sb();
    const { data: user, error: userErr } = await s.from('users')
      .select('id, name, email, password_hash, token_version, is_active')
      .eq('id', payload.userId).single();

    if (userErr || !user) return notFound();
    const u = user as Record<string, any>;
    if (!u.is_active) return error('هذا الحساب غير نشط', 403);

    const storedVersion = Number(u.token_version) || 0;
    if (payload.ver !== storedVersion) return unauthorized();

    const body = await request.json().catch(() => ({}));

    // تغيير كلمة المرور
    if (body.old_password || body.new_password) {
      if (!body.old_password || !body.new_password) {
        return error('يجب إدخال كلمة المرور الحالية والجديدة');
      }
      if (!u.password_hash || !(await verifyPassword(String(body.old_password), u.password_hash))) {
        return error('كلمة المرور الحالية غير صحيحة');
      }
      if (String(body.new_password).length < 8) {
        return error('كلمة المرور الجديدة يجب أن تكون 8 أحرف على الأقل');
      }

      const newHash = await hashPassword(String(body.new_password));
      const nextVersion = storedVersion + 1;
      const { error: updErr } = await s.from('users')
        .update({ password_hash: newHash, token_version: nextVersion })
        .eq('id', u.id);
      if (updErr) throw updErr;

      // إبطال الجلسات السابقة: التوكن الحالي يصبح قديماً (ver !== token_version)
      return success({ message: 'تم تغيير كلمة المرور بنجاح — سجّل الدخول مجدداً' });
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
    if (updErr) throw updErr;

    const uu = updated as Record<string, any>;
    return success({
      user: { id: uu.id, name: uu.name, email: uu.email, role: uu.role, isActive: uu.is_active },
    });
  } catch (err) {
    return serverError(err);
  }
}
