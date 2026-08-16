import { NextRequest } from 'next/server';
import { success, error, notFound, requireModulePermission, handleApiError, parseBody } from '@/lib/api-helpers';
import { getSupabase } from '@/lib/supabase-client';
import { fixedAssetUpdateSchema, hrUuid } from '@/lib/hr-validation';
import { FIXED_ASSET_COLUMNS } from '../route';

async function findAsset(companyId: string, id: string) {
  const { data, error: queryError } = await getSupabase().from('fixed_assets').select(FIXED_ASSET_COLUMNS)
    .eq('id', id).eq('company_id', companyId).maybeSingle();
  if (queryError) throw queryError;
  return data;
}

export async function GET(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const auth = await requireModulePermission(request, 'fixed_assets', 'read');
    const { id } = await params;
    if (!hrUuid.safeParse(id).success) return error('معرف الأصل غير صالح');
    const asset = await findAsset(auth.companyId, id);
    if (!asset) return notFound();
    return success({
      ...asset,
      net_book_value: Number((asset as any).purchase_cost || 0) - Number((asset as any).accumulated_depreciation || 0),
    });
  } catch (cause) {
    return handleApiError(cause);
  }
}

export async function PUT(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const auth = await requireModulePermission(request, 'fixed_assets', 'update');
    const { id } = await params;
    if (!hrUuid.safeParse(id).success) return error('معرف الأصل غير صالح');
    const parsed = fixedAssetUpdateSchema.safeParse(await parseBody(request));
    if (!parsed.success) return error(parsed.error.issues[0]?.message || 'بيانات الأصل غير صالحة');
    if (!await findAsset(auth.companyId, id)) return notFound();
    const { data, error: rpcError } = await getSupabase().rpc('update_fixed_asset_metadata_atomic', {
      p_company_id: auth.companyId,
      p_asset_id: id,
      p_patch: parsed.data,
      p_user_id: auth.userId,
    });
    if (rpcError) throw rpcError;
    return success(data);
  } catch (cause) {
    return handleApiError(cause);
  }
}

export async function DELETE(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const auth = await requireModulePermission(request, 'fixed_assets', 'delete');
    const { id } = await params;
    if (!hrUuid.safeParse(id).success) return error('معرف الأصل غير صالح');
    if (!await findAsset(auth.companyId, id)) return notFound();
    const { data, error: rpcError } = await getSupabase().rpc('dispose_fixed_asset_atomic', {
      p_company_id: auth.companyId,
      p_asset_id: id,
      p_user_id: auth.userId,
    });
    if (rpcError) throw rpcError;
    return success(data);
  } catch (cause) {
    return handleApiError(cause);
  }
}
