import { NextRequest } from 'next/server';
import { success, error, parseBody, requireModulePermission, handleApiError } from '@/lib/api-helpers';
import { getSupabase } from '@/lib/supabase-client';
import { communicationUuid, notificationReadSchema } from '@/lib/communication-validation';

const COLUMNS = 'id,user_id,type,title,message,link,entity_type,entity_id,is_read,read_at,created_at';

export async function PUT(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const auth = await requireModulePermission(request, 'notifications', 'update');
    const { id } = await params;
    if (!communicationUuid.safeParse(id).success) return error('معرف الإشعار غير صالح');
    const parsed = notificationReadSchema.safeParse(await parseBody(request));
    if (!parsed.success) return error('بيانات تحديث الإشعار غير صالحة');
    const isRead = parsed.data.isRead ?? true;
    const { data, error: updateError } = await getSupabase().from('notifications')
      .update({ is_read: isRead, read_at: isRead ? new Date().toISOString() : null })
      .eq('id', id).eq('company_id', auth.companyId).eq('user_id', auth.userId).select(COLUMNS).maybeSingle();
    if (updateError) throw updateError;
    if (!data) return error('الإشعار غير موجود', 404);
    return success(data);
  } catch (cause) {
    return handleApiError(cause);
  }
}

export async function DELETE(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const auth = await requireModulePermission(request, 'notifications', 'delete');
    const { id } = await params;
    if (!communicationUuid.safeParse(id).success) return error('معرف الإشعار غير صالح');
    const { data, error: deleteError } = await getSupabase().from('notifications').delete()
      .eq('id', id).eq('company_id', auth.companyId).eq('user_id', auth.userId).select('id').maybeSingle();
    if (deleteError) throw deleteError;
    if (!data) return error('الإشعار غير موجود', 404);
    return success({ deleted: true });
  } catch (cause) {
    return handleApiError(cause);
  }
}
