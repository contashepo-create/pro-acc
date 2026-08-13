import { requireAdmin, adminJsonError } from '@/lib/admin-guard';
import { NextRequest } from 'next/server';
import { getSupabase } from '@/lib/supabase-client';
import { success, error, parseBody } from '@/lib/api-helpers';
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

    const body = await parseBody<{ companyId: string; is_active: boolean }>(request);
    if (!body.companyId || typeof body.is_active !== 'boolean') {
      return error('companyId و is_active مطلوبان');
    }
    if (!/^[0-9a-fA-F-]{8,}$/.test(body.companyId)) {
      return error('معرّف الشركة غير صالح', 400);
    }

    const s = sb();
    const { data: company, error: companyErr } = await s.from('companies')
      .select('id, name, is_active')
      .eq('id', body.companyId)
      .single();

    if (companyErr || !company) {
      return error('الشركة غير موجودة', 404);
    }

    const { error: updateErr } = await s.from('companies')
      .update({ is_active: body.is_active, updated_at: new Date().toISOString() })
      .eq('id', body.companyId);
    if (updateErr) throw updateErr;

    await auditLog(
      __admin.adminId,
      body.is_active ? 'activate_company' : 'deactivate_company',
      JSON.stringify({ companyName: company.name, previousState: company.is_active }),
      'company',
      body.companyId
    );

    return success({
      message: body.is_active ? 'تم تفعيل الشركة بنجاح' : 'تم إيقاف الشركة بنجاح',
    });
  } catch (err) {
    return adminJsonError(err);
  }
}
