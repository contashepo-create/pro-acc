import { requireAdmin, adminJsonError } from '@/lib/admin-guard';
import { NextRequest } from 'next/server';
import { getSupabase } from '@/lib/supabase-client';
import { success, error, serverError, parseBody } from '@/lib/api-helpers';
import { verifyMasterPassword } from '@/lib/admin-auth';

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

    if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(body.userId)) {
      return error('معرّف المستخدم غير صالح');
    }
    const { error: updateErr } = await sb().rpc('set_company_user_status_atomic', {
      p_user_id: body.userId,
      p_admin_id: __admin.adminId,
      p_is_active: body.is_active,
    });
    if (updateErr) {
      const message = String(updateErr.message || '');
      if (message.includes('المستخدم غير موجود')) return error(message, 404);
      if (message.includes('آخر مدير')) return error(message, 409);
      throw updateErr;
    }

    return success({
      message: body.is_active ? 'تم تفعيل المستخدم بنجاح' : 'تم إيقاف المستخدم بنجاح',
    });
  } catch (err) {
    return adminJsonError(err);
  }
}
