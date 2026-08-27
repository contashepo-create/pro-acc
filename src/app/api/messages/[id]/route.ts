import { NextRequest } from 'next/server';
import { success, error, handleApiError, requireModulePermission } from '@/lib/api-helpers';
import { getSupabase } from '@/lib/supabase-client';
import { communicationUuid } from '@/lib/communication-validation';

export async function GET(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const auth = await requireModulePermission(request, 'messages', 'read');
    const { id } = await params;
    if (!communicationUuid.safeParse(id).success) return error('معرف الرسالة غير صالح');
    const { data, error: queryError } = await getSupabase().from('messages')
      .select('id,company_id,sender_id,subject,body,is_read,read_at,created_at,sender:users!sender_id(id,name,email)')
      .eq('id', id).eq('company_id', auth.companyId).is('deleted_at', null).single();
    if (queryError || !data) return error('الرسالة غير موجودة', 404);
    return success(data);
  } catch (cause) {
    return handleApiError(cause);
  }
}

export async function PATCH(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const auth = await requireModulePermission(request, 'messages', 'update');
    const { id } = await params;
    if (!communicationUuid.safeParse(id).success) return error('معرف الرسالة غير صالح');
    const { data, error: rpcError } = await getSupabase().rpc('mark_company_message_read_atomic', {
      p_company_id: auth.companyId, p_user_id: auth.userId, p_message_id: id,
    });
    if (rpcError) {
      if (/غير موجود/.test(String(rpcError.message))) return error('الرسالة غير موجودة', 404);
      if (/صادرة/.test(String(rpcError.message))) return error(String(rpcError.message), 409);
      throw rpcError;
    }
    return success(data);
  } catch (cause) {
    return handleApiError(cause);
  }
}

export async function DELETE(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const auth = await requireModulePermission(request, 'messages', 'delete');
    const { id } = await params;
    if (!communicationUuid.safeParse(id).success) return error('معرف الرسالة غير صالح');
    const { data, error: rpcError } = await getSupabase().rpc('archive_company_message_atomic', {
      p_company_id: auth.companyId, p_user_id: auth.userId, p_message_id: id,
    });
    if (rpcError) {
      if (/غير موجود/.test(String(rpcError.message))) return error('الرسالة غير موجودة', 404);
      throw rpcError;
    }
    return success(data);
  } catch (cause) {
    return handleApiError(cause);
  }
}
