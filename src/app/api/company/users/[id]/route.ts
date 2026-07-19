import { NextRequest } from 'next/server';
import { success, error, notFound, requireAdmin, requireApiAuth, handleApiError } from '@/lib/api-helpers';
import { getSupabase } from '@/lib/supabase-client';
import { hashPassword } from '@/lib/auth';

const sb = () => getSupabase();

/**
 * GET /api/company/users/[id] - Get user details
 */
export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const auth = await requireApiAuth(request);
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
 * Admin only. Cannot demote yourself.
 */
export async function PUT(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const auth = await requireAdmin(request);
    const { id } = await params;
    const s = sb();
    const body = await request.json();

    // Fetch target user
    const { data: targetUser } = await s
      .from('users')
      .select('id, role, email, name, is_active')
      .eq('id', id)
      .eq('company_id', auth.companyId)
      .maybeSingle();

    if (!targetUser) return notFound();

    const target = targetUser as { id: string; role: string; email: string; name: string; is_active: boolean };
    const updateData: Record<string, any> = {};

    // Prevent admin from demoting themselves
    if (id === auth.userId && body.role && body.role !== 'admin') {
      return error('لا يمكنك تغيير دورك الخاص. يجب أن يبقى حساب واحد على الأقل بصلاحيات مدير');
    }

    // Prevent admin from deactivating themselves
    if (id === auth.userId && body.is_active === false) {
      return error('لا يمكنك تعطيل حسابك الخاص');
    }

    if (body.name !== undefined) updateData.name = body.name.trim();
    if (body.email !== undefined) {
      if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(body.email)) {
        return error('صيغة البريد الإلكتروني غير صحيحة');
      }
      // SECURITY FIX: Check global email uniqueness (same rationale as POST)
      const newEmail = body.email.toLowerCase().trim();
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
    }
    if (body.role !== undefined) {
      const validRoles = ['admin', 'accountant', 'manager', 'supervisor'];
      if (!validRoles.includes(body.role)) {
        return error('الدور غير صالح');
      }
      updateData.role = body.role;
    }
    if (body.is_active !== undefined) updateData.is_active = body.is_active;
    if (body.password) {
      if (body.password.length < 6) {
        return error('كلمة المرور يجب أن تكون 6 أحرف على الأقل');
      }
      updateData.password_hash = await hashPassword(body.password);
    }
    if (body.phone !== undefined) updateData.phone = body.phone || null;
    if (body.birth_date !== undefined) updateData.birth_date = body.birth_date || null;
    if (body.city !== undefined) updateData.city = body.city || null;

    if (Object.keys(updateData).length === 0) {
      return error('لا توجد بيانات للتحديث');
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
    } catch {
      // ignore
    }

    return success(updated);
  } catch (err) {
    return handleApiError(err);
  }
}

/**
 * DELETE /api/company/users/[id] - Remove a user from the company
 * Admin only. Cannot delete yourself.
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

    const { data: targetUser } = await s
      .from('users')
      .select('id, role')
      .eq('id', id)
      .eq('company_id', auth.companyId)
      .maybeSingle();

    if (!targetUser) return notFound();

    // Check if this is the last admin
    const target = targetUser as { id: string; role: string };
    if (target.role === 'admin') {
      const { count: adminCount } = await s
        .from('users')
        .select('*', { count: 'exact', head: true })
        .eq('company_id', auth.companyId)
        .eq('role', 'admin')
        .eq('is_active', true);

      if ((adminCount || 0) <= 1) {
        return error('لا يمكن حذف آخر مدير في الشركة. قم بترقية مستخدم آخر أولاً');
      }
    }

    const { error: deleteError } = await s
      .from('users')
      .delete()
      .eq('id', id)
      .eq('company_id', auth.companyId);

    if (deleteError) throw deleteError;

    // Audit log
    try {
      await s.from('audit_log').insert({
        company_id: auth.companyId,
        user_id: auth.userId,
        action: 'delete_user',
        entity_type: 'user',
        entity_id: id,
        old_values: target,
      });
    } catch {
      // ignore
    }

    return success({ deleted: true });
  } catch (err) {
    return handleApiError(err);
  }
}
