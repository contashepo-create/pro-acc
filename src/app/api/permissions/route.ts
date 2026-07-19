import { NextRequest } from 'next/server';
import { success, error, parseBody, requireApiAuth, requireAdmin, handleApiError } from '@/lib/api-helpers';
import { 
  getUserPermissions, 
  setUserPermission, 
  getCompanyUsersWithPermissions,
  MODULES,
  ACTIONS,
  canBypassTelegramConfirmation,
} from '@/lib/permissions';

/**
 * GET /api/permissions
 * جلب قائمة المستخدمين مع صلاحياتهم أو صلاحيات مستخدم محدد
 */
export async function GET(request: NextRequest) {
  try {
    const auth = await requireApiAuth(request);
    const url = new URL(request.url);
    const userId = url.searchParams.get('userId');

    if (userId) {
      // جلب صلاحيات مستخدم محدد
      const perms = await getUserPermissions(userId, auth.companyId);
      return success(perms);
    }

    // جلب جميع المستخدمين مع صلاحياتهم
    const users = await getCompanyUsersWithPermissions(auth.companyId);
    
    return success({
      users,
      modules: Object.values(MODULES),
      actions: Object.values(ACTIONS),
    });
  } catch (err) {
    return handleApiError(err);
  }
}

/**
 * POST /api/permissions
 * حفظ صلاحيات مخصصة لمستخدم
 */
export async function POST(request: NextRequest) {
  try {
    const auth = await requireAdmin(request);
    const data = await parseBody<{
      user_id: string;
      module: string;
      actions: string[];
      bypass_telegram?: boolean;
    }>(request);

    const { user_id, module, actions, bypass_telegram } = data;

    if (!user_id) {
      return error('user_id مطلوب');
    }

    // التحقق من أن المستخدم ينتمي لنفس الشركة
    const { getSupabase } = await import('@/lib/supabase-client');
    const s = getSupabase();
    
    const { data: targetUser } = await s.from('users')
      .select('id')
      .eq('id', user_id)
      .eq('company_id', auth.companyId)
      .maybeSingle();

    if (!targetUser) {
      return error('المستخدم غير موجود');
    }

    await setUserPermission(
      user_id,
      auth.companyId,
      module || 'general',
      actions || [],
      bypass_telegram || false
    );

    return success({ message: 'تم حفظ الصلاحيات بنجاح' });
  } catch (err) {
    return handleApiError(err);
  }
}

/**
 * DELETE /api/permissions
 * حذف الصلاحيات المخصصة لمستخدم (يعود للصلاحيات الافتراضية للدور)
 */
export async function DELETE(request: NextRequest) {
  try {
    const auth = await requireAdmin(request);
    const url = new URL(request.url);
    const userId = url.searchParams.get('userId');
    const module = url.searchParams.get('module');

    if (!userId) return error('userId مطلوب');

    const { getSupabase } = await import('@/lib/supabase-client');
    const s = getSupabase();

    let query = s.from('user_permissions')
      .delete()
      .eq('user_id', userId)
      .eq('company_id', auth.companyId);

    if (module) {
      query = query.eq('module', module);
    }

    await query;

    return success({ message: 'تم حذف الصلاحيات المخصصة' });
  } catch (err) {
    return handleApiError(err);
  }
}
