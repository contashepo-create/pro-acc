import { NextRequest } from 'next/server';
import { success, error, parseBody, requireModulePermission, handleApiError } from '@/lib/api-helpers';
import { getSupabase } from '@/lib/supabase-client';
import { safeInternalPath } from '@/lib/safe-input';
import { notificationCreateSchema } from '@/lib/communication-validation';

const NOTIFICATION_COLUMNS = 'id,user_id,type,title,message,link,entity_type,entity_id,is_read,read_at,created_at';

export async function GET(request: NextRequest) {
  try {
    const auth = await requireModulePermission(request, 'notifications', 'read');
    const limit = Math.min(100, Math.max(1, Number(request.nextUrl.searchParams.get('limit')) || 50));
    const { data, error: queryError } = await getSupabase().from('notifications').select(NOTIFICATION_COLUMNS)
      .eq('company_id', auth.companyId).or(`user_id.is.null,user_id.eq.${auth.userId}`)
      .order('created_at', { ascending: false }).limit(limit);
    if (queryError) throw queryError;
    return success(data || []);
  } catch (cause) {
    return handleApiError(cause);
  }
}

export async function POST(request: NextRequest) {
  try {
    const auth = await requireModulePermission(request, 'notifications', 'create');
    const parsed = notificationCreateSchema.safeParse(await parseBody(request));
    if (!parsed.success) return error(parsed.error.issues[0]?.message || 'بيانات الإشعار غير صالحة');
    const link = safeInternalPath(parsed.data.link);
    if (parsed.data.link && !link) return error('رابط الإشعار يجب أن يكون مساراً داخلياً آمناً');
    const { data, error: insertError } = await getSupabase().from('notifications').insert({
      company_id: auth.companyId, user_id: auth.userId, type: parsed.data.type,
      title: parsed.data.title, message: parsed.data.message, link,
    }).select(NOTIFICATION_COLUMNS).single();
    if (insertError) throw insertError;
    return success(data, 201);
  } catch (cause) {
    return handleApiError(cause);
  }
}
