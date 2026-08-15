import { NextRequest } from 'next/server';
import { success, error, parseBody, requireApiAuth, requireModulePermission, handleApiError } from '@/lib/api-helpers';
import { getSupabase } from '@/lib/supabase-client';
import { safeInternalPath } from '@/lib/safe-input';

const sb = () => getSupabase();

export async function GET(req: NextRequest) {
  try {
    const auth = await requireModulePermission(req, 'notifications', 'read');
    const s = sb();
    const limit = Math.min(100, Math.max(1, parseInt(req.nextUrl.searchParams.get('limit') || '50') || 50));
    const { data, error: queryError } = await s.from('notifications')
      .select('*')
      .eq('company_id', auth.companyId)
      .or(`user_id.is.null,user_id.eq.${auth.userId}`)
      .order('created_at', { ascending: false })
      .limit(limit);
    if (queryError) throw queryError;
    return success(data || []);
  } catch (err) {
    return handleApiError(err);
  }
}

export async function POST(req: NextRequest) {
  try {
    const auth = await requireModulePermission(req, 'notifications', 'create');
    const s = sb();
    const { type, title, message, link } = await parseBody(req);
    if (typeof type !== 'string' || !/^[a-z0-9_-]{1,40}$/i.test(type)) return error('نوع الإشعار غير صالح');
    if (typeof title !== 'string' || !title.trim() || title.length > 160) return error('عنوان الإشعار غير صالح');
    if (typeof message !== 'string' || !message.trim() || message.length > 1000) return error('نص الإشعار غير صالح');
    const safeLink = safeInternalPath(link);
    if (link && !safeLink) return error('رابط الإشعار يجب أن يكون مساراً داخلياً آمناً');
    const { data: result, error: insertError } = await s.from('notifications')
      .insert({ company_id: auth.companyId, user_id: auth.userId, type, title: title.trim(), message: message.trim(), link: safeLink })
      .select('*').single();
    if (insertError) throw insertError;
    return success(result);
  } catch (err) {
    return handleApiError(err);
  }
}
