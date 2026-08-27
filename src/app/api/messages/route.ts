import { NextRequest } from 'next/server';
import { success, error, handleApiError, requireModulePermission, parseBody } from '@/lib/api-helpers';
import { getSupabase } from '@/lib/supabase-client';
import { companyMessageSchema } from '@/lib/communication-validation';

const MESSAGE_COLUMNS = 'id,company_id,sender_id,subject,body,is_read,read_at,created_at,sender:users!sender_id(id,name,email)';

export async function GET(request: NextRequest) {
  try {
    const auth = await requireModulePermission(request, 'messages', 'read');
    const { searchParams } = new URL(request.url);
    const limit = Math.min(Math.max(Number(searchParams.get('limit')) || 50, 1), 100);
    const offset = Math.max(Number(searchParams.get('offset')) || 0, 0);
    const { data, error: queryError, count } = await getSupabase().from('messages').select(MESSAGE_COLUMNS, { count: 'exact' })
      .eq('company_id', auth.companyId).is('deleted_at', null).order('created_at', { ascending: false }).range(offset, offset + limit - 1);
    if (queryError) throw queryError;
    return success({ messages: data || [], total: count || 0, limit, offset });
  } catch (cause) {
    return handleApiError(cause);
  }
}

export async function POST(request: NextRequest) {
  try {
    const auth = await requireModulePermission(request, 'messages', 'create');
    const parsed = companyMessageSchema.safeParse(await parseBody(request));
    if (!parsed.success) return error(parsed.error.issues[0]?.message || 'بيانات الرسالة غير صالحة');
    const { data, error: rpcError } = await getSupabase().rpc('send_company_message_atomic', {
      p_company_id: auth.companyId, p_user_id: auth.userId, p_subject: parsed.data.subject, p_body: parsed.data.body,
    });
    if (rpcError) throw rpcError;
    return success(data, 201);
  } catch (cause) {
    return handleApiError(cause);
  }
}
