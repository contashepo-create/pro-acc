import { requireAdmin, adminJsonError } from '@/lib/admin-guard';
import { NextRequest } from 'next/server';
import { getSupabase } from '@/lib/supabase-client';
import { success, error, parseBody } from '@/lib/api-helpers';
import { verifyMasterPassword } from '@/lib/admin-auth';

const sb = () => getSupabase();
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

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

    const body = await parseBody<{ companyId: string; is_active: boolean }>(request);
    if (!body.companyId || typeof body.is_active !== 'boolean') {
      return error('companyId و is_active مطلوبان');
    }
    if (!UUID.test(body.companyId)) {
      return error('معرّف الشركة غير صالح', 400);
    }

    const { error: updateErr } = await sb().rpc('set_company_status_atomic', {
      p_company_id: body.companyId,
      p_admin_id: __admin.adminId,
      p_is_active: body.is_active,
    });
    if (updateErr) {
      const message = String(updateErr.message || '');
      if (message.includes('الشركة غير موجودة')) return error(message, 404);
      throw updateErr;
    }

    return success({
      message: body.is_active ? 'تم تفعيل الشركة بنجاح' : 'تم إيقاف الشركة بنجاح',
    });
  } catch (err) {
    return adminJsonError(err);
  }
}
