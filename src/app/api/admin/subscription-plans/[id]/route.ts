import { requireAdmin, adminJsonError } from '@/lib/admin-guard';
import { NextRequest } from 'next/server';
import { getSupabase } from '@/lib/supabase-client';
import { success, error, parseBody } from '@/lib/api-helpers';
import { verifyMasterPassword } from '@/lib/admin-auth';
import { normalizeAdminPlanInput } from '@/lib/admin-plan-input';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export async function PUT(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const admin = await requireAdmin(req);
    const { id } = await params;
    if (!UUID.test(id)) return error('معرّف الباقة غير صالح');
    const parsed = normalizeAdminPlanInput(await parseBody<unknown>(req), true);
    if (parsed.ok === false) return error(parsed.message);

    const { data, error: updateError } = await getSupabase().rpc('admin_manage_subscription_plan', {
      p_admin_id: admin.adminId,
      p_action: 'update',
      p_plan_id: id,
      p_payload: parsed.payload,
    });
    if (updateError) {
      const message = String(updateError.message || '');
      if (updateError.code === '23505') return error('كود الباقة مستخدم مسبقاً', 409);
      if (/code of a used plan/i.test(message)) return error('لا يمكن تغيير كود باقة مرتبطة باشتراكات تاريخية', 409);
      throw updateError;
    }
    if ((data as { not_found?: boolean } | null)?.not_found) return error('الباقة غير موجودة', 404);
    return success(data);
  } catch (err) {
    return adminJsonError(err);
  }
}

export async function DELETE(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const admin = await requireAdmin(req);
    const { id } = await params;
    if (!UUID.test(id)) return error('معرّف الباقة غير صالح');
    const masterPassword = req.headers.get('x-master-password');
    if (!masterPassword) return error('كلمة المرور الرئيسية مطلوبة', 401);
    if (!await verifyMasterPassword(admin.adminId, masterPassword)) return error('كلمة المرور الرئيسية غير صحيحة', 401);

    const { data, error: deleteError } = await getSupabase().rpc('delete_unused_subscription_plan_atomic', {
      p_plan_id: id,
      p_admin_id: admin.adminId,
    });
    if (deleteError) {
      const message = String(deleteError.message || '');
      if (message.includes('الباقة غير موجودة')) return error(message, 404);
      if (message.includes('اشتراكات تاريخية')) return error(message, 409);
      throw deleteError;
    }
    return success(data);
  } catch (err) {
    return adminJsonError(err);
  }
}
