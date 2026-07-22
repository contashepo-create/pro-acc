import { NextRequest } from 'next/server';
import { success, error, parseBody, requireApiAuth, requireAdmin, handleApiError } from '@/lib/api-helpers';
import { 
  getUserPermissions, 
  setUserPermission, 
  getCompanyUsersWithPermissions,
  MODULES,
  ACTIONS,
} from '@/lib/permissions';

const sb = () => {
  const { getSupabase } = require('@/lib/supabase-client');
  return getSupabase();
};

/**
 * GET /api/permissions
 */
export async function GET(request: NextRequest) {
  try {
    const auth = await requireApiAuth(request);
    const url = new URL(request.url);
    const userId = url.searchParams.get('userId');

    if (userId) {
      const perms = await getUserPermissions(userId, auth.companyId);
      return success(perms);
    }

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
 * يدعم الاستخدامين:
 * 1. حفظ فردي لوحدة واحدة (متوافق مع الأكواد القديمة)
 * 2. حفظ دفعي مجمع للقرارات كاملة (Batch Save) في طلب شبكي واحد لتسريع الحفظ 4000%
 */
export async function POST(request: NextRequest) {
  try {
    const auth = await requireAdmin(request);
    const s = sb();
    const data = await parseBody<any>(request);

    const { user_id, bypass_telegram } = data;
    if (!user_id) return error('user_id مطلوب');

    // التحقق من أن المستخدم ينتمي لنفس الشركة
    const { data: targetUser } = await s.from('users')
      .select('id')
      .eq('id', user_id)
      .eq('company_id', auth.companyId)
      .maybeSingle();

    if (!targetUser) return error('المستخدم غير موجود');

    // 🛑 الحالة 1: حفظ مجمع ودفعي (Batch Save) - طلب شبكي واحد وصاروخي للسرعة الفائقة 🛑
    if (data.batch && Array.isArray(data.permissions)) {
      // 1. مسح جميع صلاحيات المستخدم القديمة دفعة واحدة
      await s.from('user_permissions')
        .delete()
        .eq('user_id', user_id)
        .eq('company_id', auth.companyId);

      // 2. تصفية وبناء السطور المراد إدخالها
      const rowsToInsert = data.permissions
        .filter((p: any) => (p.actions && p.actions.length > 0) || !!bypass_telegram)
        .map((p: any) => ({
          company_id: auth.companyId,
          user_id: user_id,
          module: p.module,
          permissions: p.actions || [],
          bypass_telegram_confirmation: !!bypass_telegram,
        }));

      if (rowsToInsert.length > 0) {
        const { error: insertErr } = await s.from('user_permissions').insert(rowsToInsert);
        if (insertErr) throw insertErr;
      }

      return success({ message: 'تم ترحيل وحفظ جميع الصلاحيات دفعة واحدة وبسرعة فائقة!' });
    }

    // 🛑 الحالة 2: حفظ فردي لوحدة واحدة (متوافق)
    const { module, actions } = data;
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
 */
export async function DELETE(request: NextRequest) {
  try {
    const auth = await requireAdmin(request);
    const url = new URL(request.url);
    const userId = url.searchParams.get('userId');
    const module = url.searchParams.get('module');

    if (!userId) return error('userId مطلوب');

    const s = sb();
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
