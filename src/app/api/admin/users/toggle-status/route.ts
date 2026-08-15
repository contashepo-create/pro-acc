import { requireAdmin, adminJsonError } from '@/lib/admin-guard';
import { NextRequest } from 'next/server';
import { getSupabase } from '@/lib/supabase-client';
import { success, error, serverError, parseBody } from '@/lib/api-helpers';
import { verifyMasterPassword, auditLog } from '@/lib/admin-auth';

const sb = () => getSupabase();

export async function POST(request: NextRequest) {
  try {
  const __admin = await requireAdmin(request);

    const masterHeader = request.headers.get('x-master-password');
    if (!masterHeader) {
      return error('كلمة المرور الرئيسية مطلوبة في ترويسة x-master-password', 401);
    }

    const valid = await verifyMasterPassword(__admin.adminId, masterHeader);
    if (!valid) {
      return error('كلمة المرور الرئيسية غير صحيحة', 401);
    }

    const body = await parseBody<{ userId: string; is_active: boolean }>(request);
    if (!body.userId || typeof body.is_active !== 'boolean') {
      return error('userId و is_active مطلوبان');
    }

    const s = sb();
    const { data: user, error: userErr } = await s.from('users')
      .select('id, name, email, company_id, role, is_active, token_version')
      .eq('id', body.userId)
      .single();

    if (userErr || !user) {
      return error('المستخدم غير موجود', 404);
    }

    if (!body.is_active && user.is_active && user.role === 'admin') {
      const { count } = await s.from('users').select('*', { count: 'exact', head: true })
        .eq('company_id', user.company_id).eq('role', 'admin').eq('is_active', true);
      if ((count || 0) <= 1) return error('لا يمكن تعطيل آخر مدير نشط للشركة', 409);
    }

    const { error: updateErr } = await s.from('users')
      .update({
        is_active: body.is_active,
        ...(body.is_active ? {} : { token_version: (Number(user.token_version) || 0) + 1 }),
        updated_at: new Date().toISOString(),
      })
      .eq('id', body.userId);
    if (updateErr) throw updateErr;

    await auditLog(
      __admin.adminId,
      body.is_active ? 'activate_user' : 'deactivate_user',
      JSON.stringify({ userName: user.name, userEmail: user.email, previousState: user.is_active }),
      'user',
      body.userId
    );

    return success({
      message: body.is_active ? 'تم تفعيل المستخدم بنجاح' : 'تم إيقاف المستخدم بنجاح',
    });
  } catch (err) {
    return adminJsonError(err);
  }
}
