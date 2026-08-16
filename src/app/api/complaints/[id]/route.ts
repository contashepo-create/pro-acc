import { NextRequest } from 'next/server';
import { success, error, requireModulePermission, handleApiError, parseBody } from '@/lib/api-helpers';
import { getSupabase } from '@/lib/supabase-client';
import { communicationUuid, complaintPatchSchema } from '@/lib/communication-validation';

export async function DELETE(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const auth = await requireModulePermission(request, 'complaints', 'delete');
    const { id } = await params;
    if (!communicationUuid.safeParse(id).success) return error('معرف الشكوى غير صالح');
    const { data, error: rpcError } = await getSupabase().rpc('archive_company_complaint_atomic', {
      p_company_id: auth.companyId, p_user_id: auth.userId, p_complaint_id: id,
    });
    if (rpcError) {
      if (/غير موجود/.test(String(rpcError.message))) return error('الشكوى غير موجودة', 404);
      throw rpcError;
    }
    return success(data);
  } catch (cause) {
    return handleApiError(cause);
  }
}

export async function PATCH(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const auth = await requireModulePermission(request, 'complaints', 'update');
    const { id } = await params;
    if (!communicationUuid.safeParse(id).success) return error('معرف الشكوى غير صالح');
    const parsed = complaintPatchSchema.safeParse(await parseBody(request));
    if (!parsed.success) return error(parsed.error.issues[0]?.message || 'بيانات تحديث الشكوى غير صالحة');
    const { data, error: rpcError } = await getSupabase().rpc('update_company_complaint_atomic', {
      p_company_id: auth.companyId, p_user_id: auth.userId, p_complaint_id: id, p_patch: parsed.data,
    });
    if (rpcError) {
      const message = String(rpcError.message || 'تعذر تحديث الشكوى');
      if (/غير موجود/.test(message)) return error('الشكوى غير موجودة', 404);
      if (/قيد المعالجة/.test(message)) return error(message, 409);
      throw rpcError;
    }
    return success(data);
  } catch (cause) {
    return handleApiError(cause);
  }
}
