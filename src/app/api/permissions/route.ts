import { getSupabase } from '@/lib/supabase-client';
import { NextRequest } from 'next/server';
import { success, error, parseBody, requireApiAuth, requireAdmin, handleApiError } from '@/lib/api-helpers';

import type { Row } from '@/lib/types';
import { 
  getUserPermissions, 
  setUserPermission, 
  getCompanyUsersWithPermissions,
  MODULES,
  ACTIONS,
} from '@/lib/permissions';

const sb = () => getSupabase();

/**
 * GET /api/permissions
 */
export async function GET(request: NextRequest) {
  try {
    const auth = await requireApiAuth(request);
    const url = new URL(request.url);
    const userId = url.searchParams.get('userId');

    if (userId) {
      if (userId !== auth.userId && !['admin', 'manager'].includes(auth.role)) {
        return error('ليس لديك صلاحية لعرض صلاحيات مستخدم آخر', 403);
      }
      const s = sb();
      const { data: target, error: targetErr } = await s.from('users')
        .select('id').eq('id', userId).eq('company_id', auth.companyId).maybeSingle();
      if (targetErr) throw targetErr;
      if (!target) return error('المستخدم غير موجود', 404);

      const perms = await getUserPermissions(userId, auth.companyId);
      return success(perms);
    }

    // قائمة كل مستخدمي الشركة وصلاحياتهم — يطّلع عليها المدير فأعلى فقط
    if (auth.role !== 'admin' && auth.role !== 'manager') {
      return error('ليس لديك صلاحية لعرض صلاحيات المستخدمين', 403);
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
    const data = await parseBody<Row>(request);

    const { user_id, bypass_telegram } = data;
    if (!user_id) return error('user_id مطلوب');
    if (bypass_telegram !== undefined && typeof bypass_telegram !== 'boolean') return error('قيمة تجاوز تيليجرام غير صالحة');

    // التحقق من أن المستخدم ينتمي لنفس الشركة
    const { data: targetUser, error: targetUserErr } = await s.from('users')
      .select('id')
      .eq('id', user_id)
      .eq('company_id', auth.companyId)
      .maybeSingle();
    if (targetUserErr) throw targetUserErr;

    if (!targetUser) return error('المستخدم غير موجود', 404);

    // 🛑 الحالة 1: حفظ مجمع ودفعي (Batch Save) - طلب شبكي واحد وصاروخي للسرعة الفائقة 🛑
    if (data.batch && Array.isArray(data.permissions)) {
      // التحقق من صحة الوحدات والإجراءات لمنع تخزين قيم عشوائية
      const { data: customModules, error: customModulesError } = await s.from('custom_modules')
        .select('code, name').eq('company_id', auth.companyId).eq('is_active', true);
      if (customModulesError) throw customModulesError;
      const validModules = new Set<string>([
        ...(Object.values(MODULES) as string[]),
        ...((customModules ?? []) as Row[]).flatMap((row: Row) => [String(row.code), String(row.name)]).filter(Boolean),
      ]);
      const validActions = new Set<string>([...Object.values(ACTIONS), '*']);
      for (const p of data.permissions) {
        if (!p.module || !validModules.has(p.module)) {
          return error(`وحدة غير صالحة: ${p.module || '(فارغة)'}`);
        }
        for (const a of (p.actions || [])) {
          if (!validActions.has(a)) {
            return error(`إجراء غير صالح: ${a}`);
          }
        }
      }

      if (data.permissions.length > 200 || new Set(data.permissions.map((permission: Row) => permission.module)).size !== data.permissions.length) {
        return error('قائمة الصلاحيات مكررة أو كبيرة جداً');
      }
      const { error: replaceError } = await s.rpc('replace_user_permissions', {
        p_company_id: auth.companyId, p_user_id: user_id,
        p_permissions: data.permissions, p_bypass_telegram: !!bypass_telegram,
      });
      if (replaceError) throw replaceError;
      return success({ message: 'تم حفظ جميع الصلاحيات بنجاح' });
    }

    // 🛑 الحالة 2: حفظ فردي لوحدة واحدة (متوافق)
    const { module: moduleName, actions } = data;
    const { data: customModules, error: customModulesError } = await s.from('custom_modules')
      .select('code, name').eq('company_id', auth.companyId).eq('is_active', true);
    if (customModulesError) throw customModulesError;
    const validModules = new Set<string>([
      ...(Object.values(MODULES) as string[]),
      ...((customModules ?? []) as Row[]).flatMap((row: Row) => [String(row.code), String(row.name)]).filter(Boolean),
    ]);
    const validActions = new Set<string>([...Object.values(ACTIONS), '*']);
    if (!moduleName || !validModules.has(String(moduleName)) || !Array.isArray(actions) || actions.some((action: string) => !validActions.has(action))) {
      return error('الوحدة أو الإجراءات غير صالحة');
    }
    await setUserPermission(
      String(user_id),
      auth.companyId,
      String(moduleName || 'general'),
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
    const moduleName = url.searchParams.get('module');

    if (!userId) return error('userId مطلوب');

    const s = sb();
    let query = s.from('user_permissions')
      .delete()
      .eq('user_id', userId)
      .eq('company_id', auth.companyId);

    if (moduleName) {
      query = query.eq('module', moduleName);
    }

    const { error: deleteErr } = await query;
    if (deleteErr) throw deleteErr;

    return success({ message: 'تم حذف الصلاحيات المخصصة' });
  } catch (err) {
    return handleApiError(err);
  }
}
