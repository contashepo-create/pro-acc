import { requireAdmin, adminJsonError } from '@/lib/admin-guard';
import { NextRequest } from 'next/server';
import { getSupabase } from '@/lib/supabase-client';
import { success, error, serverError, notFound, parseBody } from '@/lib/api-helpers';
import { verifyMasterPassword, auditLog } from '@/lib/admin-auth';

const sb = () => getSupabase();

export async function PATCH(
  request: NextRequest,
  { params: paramsPromise }: { params: Promise<{ id: string }> }
) {
  try {
    const __admin = await requireAdmin(request);
    const { id } = await paramsPromise;
    if (!/^[0-9a-fA-F-]{8,}$/.test(id)) return error('معرّف المستخدم غير صالح', 400);

    const masterHeader = request.headers.get('x-master-password');
    if (!masterHeader) {
      return error('كلمة المرور الرئيسية مطلوبة في ترويسة x-master-password', 401);
    }

    const body = await parseBody<{ is_active: boolean }>(request);
    if (typeof body.is_active !== 'boolean') {
      return error('is_active يجب أن يكون true أو false');
    }

    const valid = await verifyMasterPassword(__admin.adminId, masterHeader);
    if (!valid) {
      return error('كلمة المرور الرئيسية غير صحيحة', 401);
    }

    const s = sb();
    const { data: user, error: userErr } = await s.from('users')
      .select('id, name, email, company_id, role, is_active, token_version')
      .eq('id', id)
      .single();

    if (userErr || !user) {
      return notFound();
    }

    if (!body.is_active && user.is_active && user.role === 'admin') {
      const { count } = await s.from('users').select('*', { count: 'exact', head: true })
        .eq('company_id', user.company_id).eq('role', 'admin').eq('is_active', true);
      if ((count || 0) <= 1) return error('لا يمكن تعطيل آخر مدير نشط للشركة', 409);
    }

    const { error: updateErr } = await s.from('users')
      .update({
        is_active: body.is_active,
        // Invalidate all existing sessions immediately when disabling.
        ...(body.is_active ? {} : { token_version: (Number((user as any).token_version) || 0) + 1 }),
        updated_at: new Date().toISOString(),
      })
      .eq('id', id);
    if (updateErr) throw updateErr;

    await auditLog(
      __admin.adminId,
      body.is_active ? 'activate_user' : 'deactivate_user',
      JSON.stringify({ userName: user.name, userEmail: user.email, previousState: user.is_active }),
      'user',
      id
    );

    return success({
      message: body.is_active ? 'تم تفعيل المستخدم بنجاح' : 'تم إيقاف المستخدم بنجاح',
    });
  } catch (err) {
    return adminJsonError(err);
  }
}
