import { NextRequest } from 'next/server';
import { success, error, requireAdmin, handleApiError } from '@/lib/api-helpers';
import { getSupabase } from '@/lib/supabase-client';
import { hashPassword } from '@/lib/auth';

const sb = () => getSupabase();

/**
 * GET /api/company/users - List all users in the current company
 * Restricted to admin only
 */
export async function GET(request: NextRequest) {
  try {
    const auth = await requireAdmin(request);
    const s = sb();

    const { data: users, error: queryError } = await s
      .from('users')
      .select('id, email, name, role, is_active, last_login, created_at')
      .eq('company_id', auth.companyId)
      .order('created_at', { ascending: false });

    if (queryError) throw queryError;

    // Get current user count for limit checking
    const { count } = await s
      .from('users')
      .select('*', { count: 'exact', head: true })
      .eq('company_id', auth.companyId);

    // Get max_users from subscription plan
    let maxUsers: number | null = null;
    try {
      const { data: sub } = await s
        .from('subscriptions')
        .select('plan_code')
        .eq('company_id', auth.companyId)
        .eq('status', 'active')
        .maybeSingle();

      if (sub) {
        const { data: plan } = await s
          .from('subscription_plans')
          .select('max_users')
          .eq('code', (sub as { plan_code: string }).plan_code)
          .maybeSingle();
        maxUsers = (plan as { max_users: number } | null)?.max_users ?? null;
      }
    } catch {
      // ignore
    }

    return success({
      users: users || [],
      currentCount: count || 0,
      maxUsers,
    });
  } catch (err) {
    return handleApiError(err);
  }
}

/**
 * POST /api/company/users - Invite/add a new user to the company
 * Restricted to admin only. Checks max_users limit.
 */
export async function POST(request: NextRequest) {
  try {
    const auth = await requireAdmin(request);
    const s = sb();
    const body = await request.json();

    const { email, name, password, role } = body as {
      email?: string;
      name?: string;
      password?: string;
      role?: string;
    };

    // Validation
    if (!email || !name || !password) {
      return error('البريد الإلكتروني والاسم وكلمة المرور مطلوبة');
    }
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
      return error('صيغة البريد الإلكتروني غير صحيحة');
    }
    if (password.length < 8) {
      return error('كلمة المرور يجب أن تكون 8 أحرف على الأقل');
    }
    const validRoles = ['admin', 'accountant', 'manager', 'supervisor'];
    if (!role || !validRoles.includes(role)) {
      return error(`الدور غير صالح. الأدوار المتاحة: ${validRoles.join('، ')}`);
    }

    // Check max_users limit
    const { count: currentCount } = await s
      .from('users')
      .select('*', { count: 'exact', head: true })
      .eq('company_id', auth.companyId);

    try {
      const { data: sub } = await s
        .from('subscriptions')
        .select('plan_code')
        .eq('company_id', auth.companyId)
        .eq('status', 'active')
        .maybeSingle();

      if (sub) {
        const { data: plan } = await s
          .from('subscription_plans')
          .select('max_users')
          .eq('code', (sub as { plan_code: string }).plan_code)
          .maybeSingle();
        const maxUsers = (plan as { max_users: number } | null)?.max_users;
        if (maxUsers && (currentCount || 0) >= maxUsers) {
          return error(
            `تم الوصول للحد الأقصى للمستخدمين (${maxUsers}). يرجى ترقية الباقة لإضافة مزيد من المستخدمين`,
            403
          );
        }
      }
    } catch {
      // ignore limit check failure, allow creation
    }

    // SECURITY FIX: Check email uniqueness GLOBALLY (across all companies),
    // not just within the current company. This prevents a scenario where:
    // 1. Admin of Company A adds a user with email X
    // 2. A user in Company B already has email X
    // 3. Login (which searches by email globally using .single()) breaks for both
    // This matches the behavior of POST /api/auth/register
    const { data: existingGlobal } = await s.from('users')
      .select('id, company_id')
      .ilike('email', email.toLowerCase().trim())
      .limit(1);

    if (existingGlobal && existingGlobal.length > 0) {
      const existingUser = existingGlobal[0] as { id: string; company_id: string };
      if (existingUser.company_id === auth.companyId) {
        return error('هذا البريد الإلكتروني مستخدم بالفعل في هذه الشركة');
      } else {
        return error('هذا البريد الإلكتروني مسجل مسبقاً في نظام آخر');
      }
    }

    // Hash password and create user
    const passwordHash = await hashPassword(password);

    const { data: newUser, error: insertError } = await s
      .from('users')
      .insert({
        company_id: auth.companyId,
        email: email.toLowerCase().trim(),
        name: name.trim(),
        password_hash: passwordHash,
        role,
        is_active: true,
      })
      .select('id, email, name, role, is_active, created_at')
      .single();

    if (insertError) {
      if (insertError.code === '23505') {
        return error('هذا البريد الإلكتروني مستخدم بالفعل');
      }
      throw insertError;
    }

    // Audit log
    try {
      await s.from('audit_log').insert({
        company_id: auth.companyId,
        user_id: auth.userId,
        action: 'create_user',
        entity_type: 'user',
        entity_id: (newUser as { id: string }).id,
        new_values: { email, name, role },
      });
    } catch {
      // ignore audit log failure
    }

    return success(newUser, 201);
  } catch (err) {
    return handleApiError(err);
  }
}
