import { NextRequest } from 'next/server';
import { success, error, notFound, requireAdmin, handleApiError, parseBody } from '@/lib/api-helpers';
import { getSupabase } from '@/lib/supabase-client';
import { hashPassword } from '@/lib/auth';
import { passwordPolicy } from '@/lib/validation';

import type { Row } from '@/lib/types';

const sb = () => getSupabase();

/**
 * GET /api/company/users/[id] - Get user details
 */
export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const auth = await requireAdmin(request);
    const { id } = await params;
    const s = sb();

    const { data: user, error: queryError } = await s
      .from('users')
      .select('id, email, name, role, is_active, last_login, created_at, phone, birth_date, city')
      .eq('id', id)
      .eq('company_id', auth.companyId)
      .maybeSingle();

    if (queryError || !user) return notFound();

    return success(user);
  } catch (err) {
    return handleApiError(err);
  }
}

/**
 * PUT /api/company/users/[id] - Update user details
 * STRICT SECURITY: Enforces single-admin constraint per company & self-change blocks
 */
export async function PUT(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const auth = await requireAdmin(request);
    const { id } = await params;
    const s = sb();
    const body = await parseBody<Record<string, unknown>>(request);

    const { data: targetUser } = await s
      .from('users')
      .select('id, role, email, name, is_active, token_version')
      .eq('id', id)
      .eq('company_id', auth.companyId)
      .maybeSingle();

    if (!targetUser) return notFound();

    const target = targetUser as { id: string; role: string; email: string; name: string; is_active: boolean; token_version?: number };
    const updateData: Record<string, unknown> = {};

    if (id === auth.userId && body.role && body.role !== 'admin') {
      return error('لا يمكنك تغيير دورك الخاص. يجب أن يبقى حساب واحد على الأقل بصلاحيات مدير');
    }

    if (id === auth.userId && body.is_active === false) {
      return error('لا يمكنك تعطيل حسابك الخاص');
    }

    if (body.name !== undefined) updateData.name = String(body.name).trim();
    let emailChanged = false;
    let newEmailForVerify = '';
    if (body.email !== undefined) {
      if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(String(body.email))) {
        return error('صيغة البريد الإلكتروني غير صحيحة');
      }
      const newEmail = String(body.email).toLowerCase().trim();
      const { data: emailExists } = await s.from('users')
        .select('id')
        .ilike('email', newEmail)
        .limit(1);
      if (emailExists && emailExists.length > 0) {
        const existingRow = emailExists[0] as { id: string };
        if (existingRow.id !== id) {
          return error('هذا البريد الإلكتروني مستخدم بالفعل من حساب آخر');
        }
      }
      updateData.email = newEmail;
      // Changing a login email is an identity change: the new address must be
      // proven (same anti-hijack policy as the self-service profile route).
      if (newEmail !== String((target as Row).email || '').toLowerCase()) {
        emailChanged = true;
        newEmailForVerify = newEmail;
      }
    }
    
    if (body.role !== undefined) {
      const validRoles = ['admin', 'accountant', 'manager', 'supervisor'];
      if (!validRoles.includes(String(body.role))) {
        return error('الدور غير صالح');
      }
      
      // STRICT SECURITY: منع ترقية أي مستخدم لدور مدير نظام (admin) إذا كان هناك مدير بالفعل
      if (body.role === 'admin' && target.role !== 'admin') {
        const { count: adminCount } = await s.from('users')
          .select('*', { count: 'exact', head: true })
          .eq('company_id', auth.companyId)
          .eq('role', 'admin');

        if (adminCount && adminCount > 0) {
          return error('لا يمكن ترقية هذا الحساب لدور مدير نظام (admin). يُسمح بمدير نظام واحد فقط لكل شركة لمنع المستخدمين الإضافيين من تخطي الصلاحيات.', 403);
        }
      }

      updateData.role = body.role;
    }
    
    if (body.is_active !== undefined) updateData.is_active = body.is_active;
    if (body.password) {
      if (!passwordPolicy.safeParse(body.password).success) {
        return error('كلمة المرور لا تفي بسياسة الأمان');
      }
      updateData.password_hash = await hashPassword(String(body.password));
      updateData.token_version = (Number(target.token_version) || 0) + 1;
    }
    if (body.phone !== undefined) updateData.phone = body.phone || null;
    if (body.birth_date !== undefined) updateData.birth_date = body.birth_date || null;
    if (body.city !== undefined) updateData.city = body.city || null;

    if (Object.keys(updateData).length === 0) {
      return error('لا توجد بيانات للتحديث');
    }

    // Send the verification link BEFORE persisting the new email so an
    // undeliverable address is never stored as a login credential. The raw
    // token is never persisted — only its SHA-256 hash lands in the row.
    if (emailChanged) {
      const { randomBytes, createHash } = await import('crypto');
      const rawToken = randomBytes(32).toString('hex');
      updateData.email_verified = false;
      updateData.email_verification_token = createHash('sha256').update(rawToken).digest('hex');
      updateData.email_verification_expires = new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString();

      const configuredUrl = (process.env.NEXT_PUBLIC_APP_URL || '').trim();
      const appUrl = configuredUrl ? new URL(configuredUrl) : new URL(request.url);
      const verifyUrl = `${appUrl.origin}/verify-email?token=${rawToken}`;

      const { sendVerificationEmail } = await import('@/lib/email');
      const sent = await sendVerificationEmail(newEmailForVerify, verifyUrl);
      if (!sent && process.env.NODE_ENV === 'production') {
        return error('تعذر إرسال رابط التأكيد إلى البريد الجديد. لم يتم تغيير البريد الإلكتروني.', 503);
      }
    }

    const { data: updated, error: updateError } = await s
      .from('users')
      .update(updateData)
      .eq('id', id)
      .eq('company_id', auth.companyId)
      .select('id, email, name, role, is_active, phone, birth_date, city')
      .single();

    if (updateError) throw updateError;

    // Audit log
    try {
      await s.from('audit_log').insert({
        company_id: auth.companyId,
        user_id: auth.userId,
        action: 'update_user',
        entity_type: 'user',
        entity_id: id,
        old_values: { role: target.role, is_active: target.is_active },
        new_values: updateData,
      });
    } catch {}

    return success({ ...(updated as Record<string, unknown>), verificationPending: emailChanged });
  } catch (err) {
    return handleApiError(err);
  }
}

/**
 * DELETE /api/company/users/[id] - Remove a user from the company
 */
export async function DELETE(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const auth = await requireAdmin(request);
    const { id } = await params;
    const s = sb();

    if (id === auth.userId) {
      return error('لا يمكنك حذف حسابك الخاص');
    }

    const { data: result, error: deactivateError } = await s.rpc('deactivate_company_user_atomic', {
      p_company_id: auth.companyId,
      p_target_user_id: id,
      p_actor_user_id: auth.userId,
    });
    if (deactivateError) {
      const message = String(deactivateError.message || 'تعذر تعطيل المستخدم');
      if (/غير موجود/.test(message)) return notFound();
      if (/آخر مدير|حسابك الخاص/.test(message)) return error(message, 409);
      throw deactivateError;
    }
    return success(result);
  } catch (err) {
    return handleApiError(err);
  }
}
