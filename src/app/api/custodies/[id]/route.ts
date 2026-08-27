import { NextRequest } from 'next/server';
import { success, error, notFound, parseBody, requireModulePermission, requireManagerOrAbove, handleApiError } from '@/lib/api-helpers';
import { getSupabase } from '@/lib/supabase-client';
import { loadCustodyFile, assertFileOpen } from '@/lib/custody';
import { custodyUuid, updateCustodySchema } from '@/lib/custody-validation';

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const auth = await requireModulePermission(request, 'custodies', 'read');
    const { id } = await params;
    if (!custodyUuid.safeParse(id).success) return error('معرف ملف العهدة غير صالح');
    const file = await loadCustodyFile(auth.companyId, id);
    if (!file) return notFound();
    return success(file);
  } catch (cause) {
    return handleApiError(cause);
  }
}

export async function PUT(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const auth = await requireModulePermission(request, 'custodies', 'update');
    const { id } = await params;
    if (!custodyUuid.safeParse(id).success) return error('معرف ملف العهدة غير صالح');
    const parsed = updateCustodySchema.safeParse(await parseBody(request));
    if (!parsed.success) return error(parsed.error.issues[0]?.message || 'بيانات ملف العهدة غير صالحة');
    const file = await loadCustodyFile(auth.companyId, id);
    if (!file) return notFound();
    assertFileOpen(file);

    const { data, error: rpcError } = await getSupabase().rpc('update_custody_metadata_atomic', {
      p_company_id: auth.companyId,
      p_custody_id: id,
      p_patch: parsed.data,
      p_user_id: auth.userId,
    });
    if (rpcError) throw rpcError;
    return success(data);
  } catch (cause) {
    return handleApiError(cause);
  }
}

export async function DELETE(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const auth = await requireManagerOrAbove(request);
    const { id } = await params;
    if (!custodyUuid.safeParse(id).success) return error('معرف ملف العهدة غير صالح');
    const file = await loadCustodyFile(auth.companyId, id);
    if (!file) return notFound();
    if (file.is_closed) return error('لا يمكن إلغاء ملف مغلق', 409);
    if (file.total_expenses > 0.005) return error('لا يمكن إلغاء ملف عليه إثباتات مصروف — اعكس المصروفات أولاً', 409);

    const { data: cancelled, error: rpcError } = await getSupabase().rpc('cancel_custody_file', {
      p_company_id: auth.companyId,
      p_custody_id: id,
      p_created_by: auth.userId,
    });
    if (rpcError) throw rpcError;
    return success(cancelled);
  } catch (cause) {
    return handleApiError(cause);
  }
}
