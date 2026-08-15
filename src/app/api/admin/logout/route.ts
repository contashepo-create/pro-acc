import { NextRequest } from 'next/server';
import { success, clearAuthCookie, serverError } from '@/lib/api-helpers';
import { requireAdmin, AdminAuthError } from '@/lib/admin-guard';
import { getSupabase } from '@/lib/supabase-client';

export async function POST(request: NextRequest) {
  try {
    const token = request.cookies.get('admin_token')?.value;
    if (token) {
      // Revoke the token server-side, rather than merely deleting this
      // browser's cookie and leaving copied tokens valid for 24 hours.
      const admin = await requireAdmin(request);
      const { error } = await getSupabase().rpc('revoke_admin_sessions', { p_admin_id: admin.adminId });
      if (error) throw error;
    }
    const response = success({ message: 'تم تسجيل الخروج بنجاح' });
    clearAuthCookie(response, 'admin_token');
    clearAuthCookie(response, 'admin_session');
    return response;
  } catch (err) {
    if (err instanceof AdminAuthError) {
      const response = success({ message: 'تم تسجيل الخروج بنجاح' });
      clearAuthCookie(response, 'admin_token');
      clearAuthCookie(response, 'admin_session');
      return response;
    }
    return serverError(err);
  }
}
