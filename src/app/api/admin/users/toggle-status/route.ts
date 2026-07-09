import { NextRequest } from 'next/server';
import { getSupabase } from '@/lib/supabase-client';
import { success, error, serverError, parseBody } from '@/lib/api-helpers';
import { verifyToken } from '@/lib/auth';
import { verifyMasterPassword, auditLog } from '@/lib/admin-auth';

// @ts-ignore
const sb = () => getSupabase() as any;

export async function POST(request: NextRequest) {
  try {
    const token = request.cookies.get('admin_token')?.value;
    if (!token) return error('Unauthorized', 401);
    const payload = verifyToken(token);
    if (!payload || payload.role !== 'superadmin') return error('Unauthorized', 401);

    const masterHeader = request.headers.get('x-master-password');
    if (!masterHeader) {
      return error('كلمة المرور الرئيسية مطلوبة في ترويسة x-master-password', 401);
    }

    const valid = await verifyMasterPassword(payload.userId, masterHeader);
    if (!valid) {
      return error('كلمة المرور الرئيسية غير صحيحة', 401);
    }

    const body = await parseBody<{ userId: string; is_active: boolean }>(request);
    if (!body.userId || typeof body.is_active !== 'boolean') {
      return error('userId و is_active مطلوبان');
    }

    const s = sb();
    const { data: user, error: userErr } = await s.from('users')
      .select('id, name, email, is_active')
      .eq('id', body.userId)
      .single();

    if (userErr || !user) {
      return error('المستخدم غير موجود', 404);
    }

    const { error: updateErr } = await s.from('users')
      .update({ is_active: body.is_active, updated_at: new Date().toISOString() })
      .eq('id', body.userId);
    if (updateErr) throw updateErr;

    await auditLog(
      payload.userId,
      body.is_active ? 'activate_user' : 'deactivate_user',
      JSON.stringify({ userName: user.name, userEmail: user.email, previousState: user.is_active }),
      'user',
      body.userId
    );

    return success({
      message: body.is_active ? 'تم تفعيل المستخدم بنجاح' : 'تم إيقاف المستخدم بنجاح',
    });
  } catch (err) {
    return serverError(err);
  }
}
