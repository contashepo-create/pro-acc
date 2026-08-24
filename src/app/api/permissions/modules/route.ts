import { NextRequest } from 'next/server';
import { success, error, parseBody, requireApiAuth, requireAdmin, handleApiError } from '@/lib/api-helpers';
import { getSupabase } from '@/lib/supabase-client';
import type { Row } from '@/lib/types';

const sb = () => getSupabase();

/**
 * GET /api/permissions/modules
 * جلب جميع الأقسام (النظامية + المخصصة)
 */
export async function GET(request: NextRequest) {
  try {
    const auth = await requireApiAuth(request);
    const s = sb();

    // جلب الأقسام المخصصة
    const { data: customModules, error: queryErr } = await s.from('custom_modules')
      .select('*')
      .eq('company_id', auth.companyId)
      .order('sort_order')
      .order('name');

    if (queryErr) {
      // إذا لم يكن الجدول موجوداً بعد، نرجع قائمة فارغة
      console.warn('custom_modules table may not exist yet:', queryErr.message);
      return success({ modules: [] });
    }

    return success({ modules: customModules || [] });
  } catch (err) {
    return handleApiError(err);
  }
}

/**
 * POST /api/permissions/modules
 * إنشاء قسم جديد
 */
export async function POST(request: NextRequest) {
  try {
    const auth = await requireAdmin(request);
    const s = sb();
    const data = await parseBody<{
      name: string;
      name_en?: string;
      icon?: string;
      group_name?: string;
    }>(request);

    const { name, name_en, icon, group_name } = data;

    if (!name || name.trim().length === 0) {
      return error('اسم القسم مطلوب');
    }

    // التحقق من عدم تكرار الاسم
    const { data: existing } = await s.from('custom_modules')
      .select('id')
      .eq('company_id', auth.companyId)
      .eq('name', name.trim())
      .maybeSingle();

    if (existing) {
      return error('يوجد قسم بنفس الاسم بالفعل');
    }

    const { data: newModule, error: insertErr } = await s.from('custom_modules')
      .insert({
        company_id: auth.companyId,
        name: name.trim(),
        name_en: name_en || null,
        icon: icon || '📁',
        group_name: group_name || 'custom',
        code: `custom_${crypto.randomUUID().replace(/-/g, '')}`,
        is_system: false,
        sort_order: 100, // الأقسام المخصصة تأتي بعد النظامية
        is_active: true,
        created_by: auth.userId,
      })
      .select('*')
      .single();

    if (insertErr) {
      console.error('Error creating module:', insertErr);
      return error('فشل إنشاء القسم: ' + insertErr.message);
    }

    return success(newModule, 201);
  } catch (err) {
    return handleApiError(err);
  }
}

/**
 * DELETE /api/permissions/modules
 * حذف قسم مخصص (لا يمكن حذف الأقسام النظامية)
 */
export async function DELETE(request: NextRequest) {
  try {
    const auth = await requireAdmin(request);
    const s = sb();
    const url = new URL(request.url);
    const id = url.searchParams.get('id');

    if (!id) return error('معرف القسم مطلوب');

    const { error: deleteError } = await s.rpc('delete_custom_module_atomic', {
      p_company_id: auth.companyId,
      p_module_id: id,
      p_user_id: auth.userId,
    });
    if (deleteError) {
      const message = String(deleteError.message || 'فشل حذف القسم');
      if (/غير موجود/.test(message)) return error(message, 404);
      if (/نظامي/.test(message)) return error(message, 409);
      throw deleteError;
    }
    return success({ message: 'تم حذف القسم بنجاح' });
  } catch (err) {
    return handleApiError(err);
  }
}

/**
 * PUT /api/permissions/modules
 * تحديث قسم مخصص
 */
export async function PUT(request: NextRequest) {
  try {
    const auth = await requireAdmin(request);
    const s = sb();
    const data = await parseBody<{
      id: string;
      name?: string;
      name_en?: string;
      icon?: string;
      group_name?: string;
      is_active?: boolean;
      sort_order?: number;
    }>(request);

    const { id, name, name_en, icon, group_name, is_active, sort_order } = data;

    if (!id) return error('معرف القسم مطلوب');

    const updateData: Row = {};
    if (name !== undefined) updateData.name = name.trim();
    if (name_en !== undefined) updateData.name_en = name_en;
    if (icon !== undefined) updateData.icon = icon;
    if (group_name !== undefined) updateData.group_name = group_name;
    if (is_active !== undefined) updateData.is_active = is_active;
    if (sort_order !== undefined) updateData.sort_order = sort_order;

    const { data: updated, error: updateErr } = await s.from('custom_modules')
      .update(updateData)
      .eq('id', id)
      .eq('company_id', auth.companyId)
      .select('*')
      .single();

    if (updateErr) return error('فشل تحديث القسم: ' + updateErr.message);

    return success(updated);
  } catch (err) {
    return handleApiError(err);
  }
}
