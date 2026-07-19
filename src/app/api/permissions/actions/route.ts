import { NextRequest } from 'next/server';
import { success, error, parseBody, requireApiAuth, requireAdmin, handleApiError } from '@/lib/api-helpers';
import { getSupabase } from '@/lib/supabase-client';

const sb = () => getSupabase();

/**
 * GET /api/permissions/actions
 * جلب جميع العمليات (النظامية + المخصصة)
 */
export async function GET(request: NextRequest) {
  try {
    const auth = await requireApiAuth(request);
    const s = sb();

    const { data: customActions, error: queryErr } = await s.from('custom_actions')
      .select('*')
      .eq('company_id', auth.companyId)
      .order('sort_order')
      .order('name');

    if (queryErr) {
      console.warn('custom_actions table may not exist yet:', queryErr.message);
      return success({ actions: [] });
    }

    return success({ actions: customActions || [] });
  } catch (err) {
    return handleApiError(err);
  }
}

/**
 * POST /api/permissions/actions
 * إنشاء عملية/صلاحية جديدة
 */
export async function POST(request: NextRequest) {
  try {
    const auth = await requireAdmin(request);
    const s = sb();
    const data = await parseBody<{
      name: string;
      name_en?: string;
      icon?: string;
      code: string;
    }>(request);

    const { name, name_en, icon, code } = data;

    if (!name || name.trim().length === 0) {
      return error('اسم العملية مطلوب');
    }
    if (!code || code.trim().length === 0) {
      return error('كود العملية مطلوب');
    }

    // تحويل الكود لصيغة مناسبة (lowercase, underscores)
    const normalizedCode = code.trim().toLowerCase().replace(/\s+/g, '_').replace(/[^a-z0-9_]/g, '');

    if (normalizedCode.length === 0) {
      return error('كود العملية غير صالح - يجب أن يحتوي على أحرف إنجليزية فقط');
    }

    // التحقق من عدم تكرار الكود
    const { data: existing } = await s.from('custom_actions')
      .select('id')
      .eq('company_id', auth.companyId)
      .eq('code', normalizedCode)
      .maybeSingle();

    if (existing) {
      return error('يوجد عملية بنفس الكود بالفعل');
    }

    const { data: newAction, error: insertErr } = await s.from('custom_actions')
      .insert({
        company_id: auth.companyId,
        name: name.trim(),
        name_en: name_en || null,
        icon: icon || '⚡',
        code: normalizedCode,
        is_system: false,
        sort_order: 100,
        is_active: true,
        created_by: auth.userId,
      })
      .select('*')
      .single();

    if (insertErr) {
      console.error('Error creating action:', insertErr);
      return error('فشل إنشاء العملية: ' + insertErr.message);
    }

    return success(newAction, 201);
  } catch (err) {
    return handleApiError(err);
  }
}

/**
 * DELETE /api/permissions/actions
 * حذف عملية مخصصة (لا يمكن حذف العمليات النظامية)
 */
export async function DELETE(request: NextRequest) {
  try {
    const auth = await requireAdmin(request);
    const s = sb();
    const url = new URL(request.url);
    const id = url.searchParams.get('id');

    if (!id) return error('معرف العملية مطلوب');

    const { data: actionData } = await s.from('custom_actions')
      .select('id, code, name, is_system')
      .eq('id', id)
      .eq('company_id', auth.companyId)
      .maybeSingle();

    if (!actionData) return error('العملية غير موجودة');

    if ((actionData as any).is_system) {
      return error('لا يمكن حذف عملية نظامية');
    }

    // حذف العملية
    await s.from('custom_actions').delete().eq('id', id);

    return success({ message: 'تم حذف العملية بنجاح' });
  } catch (err) {
    return handleApiError(err);
  }
}

/**
 * PUT /api/permissions/actions
 * تحديث عملية مخصصة
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
      is_active?: boolean;
      sort_order?: number;
    }>(request);

    const { id, name, name_en, icon, is_active, sort_order } = data;

    if (!id) return error('معرف العملية مطلوب');

    const updateData: any = {};
    if (name !== undefined) updateData.name = name.trim();
    if (name_en !== undefined) updateData.name_en = name_en;
    if (icon !== undefined) updateData.icon = icon;
    if (is_active !== undefined) updateData.is_active = is_active;
    if (sort_order !== undefined) updateData.sort_order = sort_order;

    const { data: updated, error: updateErr } = await s.from('custom_actions')
      .update(updateData)
      .eq('id', id)
      .eq('company_id', auth.companyId)
      .select('*')
      .single();

    if (updateErr) return error('فشل تحديث العملية: ' + updateErr.message);

    return success(updated);
  } catch (err) {
    return handleApiError(err);
  }
}
