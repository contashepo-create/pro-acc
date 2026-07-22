import { NextRequest } from 'next/server';
import { success, error, requireAdmin, handleApiError, requireApiAuth } from '@/lib/api-helpers';
import { getSupabase } from '@/lib/supabase-client';
import { hashPassword } from '@/lib/auth';

const sb = () => getSupabase();

/**
 * GET /api/company/users - List all users in the current company
 */
export async function GET(request: NextRequest) {
  try {
    const auth = await requireApiAuth(request);
    const s = sb();

    const { data: users, error: queryError } = await s
      .from('users')
      .select('id, email, name, role, is_active, last_login, created_at, phone, birth_date, city')
      .eq('company_id', auth.companyId)
      .order('created_at', { ascending: false });

    if (queryError) throw queryError;

    const { count } = await s
      .from('users')
      .select('*', { count: 'exact', head: true })
      .eq('company_id', auth.companyId);

    let maxUsers: number | null = null;
    let planName: string | null = null;
    let planCode: string | null = null;

    try {
      const { data: sub } = await s
        .from('subscriptions')
        .select('plan_code, status')
        .eq('company_id', auth.companyId)
        .eq('status', 'active')
        .maybeSingle();

      if (sub) {
        planCode = (sub as { plan_code: string }).plan_code;
        
        const { data: plan } = await s
          .from('subscription_plans')
          .select('max_users, name')
          .eq('code', planCode)
          .maybeSingle();
        
        if (plan) {
          maxUsers = (plan as { max_users: number }).max_users ?? null;
          planName = (plan as { name: string }).name ?? null;
        }
      }
    } catch {
      // ignore
    }

    return success({
      users: users || [],
      currentCount: count || 0,
      maxUsers,
      planName,
      planCode,
    });
  } catch (err) {
    return handleApiError(err);
  }
}

/**
 * POST /api/company/users - Add a new user
 * STRICT SECURITY: Enforces single-admin constraint per company & subscription limit
 */
export async function POST(request: NextRequest) {
  try {
    const auth = await requireAdmin(request);
    const s = sb();
    const body = await request.json();

    const { email, name, password, role, phone, birth_date, city } = body as {
      email?: string;
      name?: string;
      password?: string;
      role?: string;
      phone?: string;
      birth_date?: string;
      city?: string;
    };

    if (!email || !name || !password) {
      return error('البريد الإلكتروني والاسم وكلمة المرور مطلوبة');
    }
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
      return error('صيغة البريد الإلكتروني غير صحيحة');
    }
    if (password.length < 6) {
      return error('كلمة المرور يجب أن تكون 6 أحرف على الأقل');
    }
    const validRoles = ['admin', 'accountant', 'manager', 'supervisor'];
    if (!role || !validRoles.includes(role)) {
      return error(`الدور غير صالح. الأدوار المتاحة: ${validRoles.join('، ')}`);
    }

    // STRICT SECURITY: فرض قيد وجود مدير نظام واحد فقط لكل شركة لمنع المستخدمين الإضافيين من تخطي الصلاحيات
    if (role === 'admin') {
      const { count: adminCount } = await s.from('users')
        .select('*', { count: 'exact', head: true })
        .eq('company_id', auth.companyId)
        .eq('role', 'admin');

      if (adminCount && adminCount > 0) {
        return error('لا يمكن إنشاء أكثر من حساب مدير واحد للشركة. يرجى اختيار دور مدير (manager) أو محاسب للمستخدم الجديد لمنع تخطي الصلاحيات حماية للنظام ماليًا.', 403);
      }
    }

    const { count: currentCount } = await s
      .from('users')
      .select('*', { count: 'exact', head: true })
      .eq('company_id', auth.companyId);

    let maxUsers: number | null = null;
    let planName = '';

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
          .select('max_users, name')
          .eq('code', (sub as { plan_code: string }).plan_code)
          .maybeSingle();
        
        if (plan) {
          maxUsers = (plan as { max_users: number }).max_users ?? null;
          planName = (plan as { name: string }).name ?? '';
        }
      }
    } catch {
      // ignore
    }

    if (maxUsers !== null && (currentCount || 0) >= maxUsers) {
      return error(
        `❌ تم الوصول للحد الأقصى للمستخدمين (${maxUsers} مستخدم) في باقة "${planName}". يرجى ترقية الباقة لإضافة مزيد من المستخدمين.`,
        403
      );
    }

    const { data: existingGlobal } = await s.from('users')
      .select('id, company_id')
      .ilike('email', email.toLowerCase().trim())
      .limit(1);

    if (existingGlobal && existingGlobal.length > 0) {
      const existingUser = existingGlobal[0] as { id: string; company_id: string };
      if (existingUser.company_id === auth.companyId) {
        return error('هذا البريد الإلكتروني مستخدم بالفعل في هذه الشركة');
      } else {
        return error('هذا البريد الإلكتروني مسجل مسبقاً في النظام');
      }
    }

    if (phone && !/^[\d\s+\-()]{8,20}$/.test(phone)) {
      return error('رقم الجوال غير صحيح');
    }

    const passwordHash = await hashPassword(password);

    const insertData: any = {
      company_id: auth.companyId,
      email: email.toLowerCase().trim(),
      name: name.trim(),
      password_hash: passwordHash,
      role,
      is_active: true,
    };

    if (phone) insertData.phone = phone;
    if (birth_date) insertData.birth_date = birth_date;
    if (city) insertData.city = city;

    const { data: newUser, error: insertError } = await s
      .from('users')
      .insert(insertData)
      .select('id, email, name, role, is_active, created_at, phone, birth_date, city')
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
        new_values: { email, name, role, phone, city },
      });
    } catch {}

    return success(newUser, 201);
  } catch (err) {
    return handleApiError(err);
  }
}
