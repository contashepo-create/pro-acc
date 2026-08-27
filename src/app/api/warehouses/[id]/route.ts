import { NextRequest } from 'next/server';
import { z } from 'zod';
import { success, error, notFound, parseBody, requireModulePermission, handleApiError } from '@/lib/api-helpers';
import { getSupabase } from '@/lib/supabase-client';

const sb = () => getSupabase();
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const updateSchema = z.object({
  name: z.string().trim().min(1, 'اسم المستودع مطلوب').max(200).optional(),
  location: z.string().trim().max(300).nullable().optional(),
  is_active: z.boolean().optional(),
}).strict();

export async function GET(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const auth = await requireModulePermission(request, 'warehouses', 'read');
    const { id } = await params;
    if (!UUID_RE.test(id)) return error('معرّف المستودع غير صالح');
    const { data, error: queryError } = await sb().from('warehouses').select('id, name, location, is_active')
      .eq('id', id).eq('company_id', auth.companyId).maybeSingle();
    if (queryError) throw queryError;
    if (!data) return notFound();
    return success(data);
  } catch (err) {
    return handleApiError(err);
  }
}

export async function PUT(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const auth = await requireModulePermission(request, 'warehouses', 'update');
    const { id } = await params;
    if (!UUID_RE.test(id)) return error('معرّف المستودع غير صالح');
    const parsed = updateSchema.safeParse(await parseBody(request));
    if (!parsed.success) return error(parsed.error.issues[0].message);
    if (!Object.keys(parsed.data).length) return error('لا توجد بيانات للتحديث');
    const { data, error: updateError } = await sb().rpc('update_warehouse_atomic', {
      p_company_id: auth.companyId,
      p_warehouse_id: id,
      p_patch: parsed.data,
      p_user_id: auth.userId,
    });
    const message = String(updateError?.message || '');
    if (message.includes('المستودع غير موجود')) return notFound();
    if (message.includes('اسم المستودع مستخدم')) return error('اسم المستودع مستخدم مسبقاً', 409);
    if (message.includes('لا يمكن تعطيل')) return error(message, 409);
    if (updateError) throw updateError;
    return success(data);
  } catch (err) {
    return handleApiError(err);
  }
}

export async function DELETE(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const auth = await requireModulePermission(request, 'warehouses', 'delete');
    const { id } = await params;
    if (!UUID_RE.test(id)) return error('معرّف المستودع غير صالح');
    const { data, error: deactivateError } = await sb().rpc('update_warehouse_atomic', {
      p_company_id: auth.companyId,
      p_warehouse_id: id,
      p_patch: { is_active: false },
      p_user_id: auth.userId,
    });
    const message = String(deactivateError?.message || '');
    if (message.includes('المستودع غير موجود')) return notFound();
    if (message.includes('لا يمكن تعطيل')) return error(message, 409);
    if (deactivateError) throw deactivateError;
    return success({ ...((data || {}) as Record<string, unknown>), deactivated: true });
  } catch (err) {
    return handleApiError(err);
  }
}
