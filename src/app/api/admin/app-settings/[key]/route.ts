import { NextRequest } from 'next/server';
import { success, error, notFound, requireAdminAuth, handleApiError, parseBody } from '@/lib/api-helpers';
import { getSupabase } from '@/lib/supabase-client';

const sb = () => getSupabase();

/**
 * PUT /api/admin/app-settings/[key]
 * Update a single field's metadata (label, icon, type, etc.)
 */
export async function PUT(
  request: NextRequest,
  { params }: { params: Promise<{ key: string }> }
) {
  try {
    const auth = await requireAdminAuth(request);
    const { key } = await params;
    const s = sb();
    const body = await parseBody(request);

    const updateData: any = { updated_at: new Date().toISOString(), updated_by: auth.userId };
    if (body.label !== undefined) updateData.label = body.label;
    if (body.value !== undefined) updateData.value = String(body.value);
    if (body.icon !== undefined) updateData.icon = body.icon;
    if (body.field_type !== undefined) updateData.field_type = body.field_type;
    if (body.category !== undefined) updateData.category = body.category;
    if (body.sort_order !== undefined) updateData.sort_order = body.sort_order;

    const { data: updated, error: updateErr } = await s.from('app_settings')
      .update(updateData)
      .eq('key', key)
      .select('*')
      .single();

    if (updateErr) throw updateErr;
    if (!updated) return notFound();

    return success(updated);
  } catch (err) {
    return handleApiError(err);
  }
}

/**
 * DELETE /api/admin/app-settings/[key]
 * Delete a custom field (only custom fields can be deleted)
 */
export async function DELETE(
  request: NextRequest,
  { params }: { params: Promise<{ key: string }> }
) {
  try {
    await requireAdminAuth(request);
    const { key } = await params;
    const s = sb();

    const { data: field } = await s.from('app_settings')
      .select('is_custom')
      .eq('key', key)
      .maybeSingle();

    if (!field) return notFound();

    if (!(field as any).is_custom) {
      return error('لا يمكن حذف الحقول الافتراضية، يمكن تعديلها فقط', 400);
    }

    const { error: delErr } = await s.from('app_settings')
      .delete()
      .eq('key', key);

    if (delErr) throw delErr;

    return success({ deleted: true });
  } catch (err) {
    return handleApiError(err);
  }
}
