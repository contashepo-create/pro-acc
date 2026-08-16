import { NextRequest } from 'next/server';
import { success, error, notFound, requireAdminAuth, handleApiError, parseBody } from '@/lib/api-helpers';
import { getSupabase } from '@/lib/supabase-client';

const SAFE_KEY = /^[a-z][a-z0-9_]{1,63}$/;
const SAFE_CATEGORY = /^[a-z][a-z0-9_-]{0,49}$/;

/** Update the value or existing metadata of one setting. */
export async function PUT(
  request: NextRequest,
  { params }: { params: Promise<{ key: string }> }
) {
  try {
    const auth = await requireAdminAuth(request);
    const { key } = await params;
    if (!SAFE_KEY.test(key)) return error('مفتاح الإعداد غير صالح');
    const body = await parseBody<Record<string, unknown>>(request);
    if (!body || typeof body !== 'object' || Array.isArray(body)) return error('بيانات الإعداد غير صالحة');

    const allowed = new Set(['value', 'category', 'description']);
    if (Object.keys(body).some((field) => !allowed.has(field))) return error('توجد حقول غير قابلة للتعديل');
    if (!Object.keys(body).length) return error('لا توجد حقول قابلة للتعديل');
    if (body.value !== undefined && (typeof body.value !== 'string' || body.value.length > 5000)) return error('قيمة الإعداد غير صالحة');
    if (body.category !== undefined && (typeof body.category !== 'string' || !SAFE_CATEGORY.test(body.category))) return error('تصنيف الإعداد غير صالح');
    if (body.description !== undefined && (typeof body.description !== 'string' || body.description.length > 500)) return error('وصف الإعداد طويل جداً');

    const patch: Record<string, string> = {};
    if (body.value !== undefined) patch.value = body.value as string;
    if (body.category !== undefined) patch.category = body.category as string;
    if (body.description !== undefined) patch.description = body.description as string;
    const { data, error: updateError } = await getSupabase().rpc('admin_update_app_setting', {
      p_admin_id: auth.userId,
      p_key: key,
      p_patch: patch,
    });
    if (updateError) throw updateError;
    if ((data as any)?.not_found) return notFound();
    return success(data);
  } catch (err) {
    return handleApiError(err);
  }
}

/** Delete custom keys only; built-in configuration is protected in PostgreSQL. */
export async function DELETE(
  request: NextRequest,
  { params }: { params: Promise<{ key: string }> }
) {
  try {
    const auth = await requireAdminAuth(request);
    const { key } = await params;
    if (!SAFE_KEY.test(key)) return error('مفتاح الإعداد غير صالح');
    const { data, error: deleteError } = await getSupabase().rpc('admin_delete_app_setting', {
      p_admin_id: auth.userId,
      p_key: key,
    });
    if (deleteError) throw deleteError;
    if ((data as any)?.not_found) return notFound();
    if ((data as any)?.protected) return error('لا يمكن حذف الحقول الافتراضية، يمكن تعديلها فقط');
    return success({ deleted: true });
  } catch (err) {
    return handleApiError(err);
  }
}
