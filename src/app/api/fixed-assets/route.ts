import { NextRequest } from 'next/server';
import { success, error, parseBody, getPaginationParams, requireModulePermission, handleApiError } from '@/lib/api-helpers';
import { getSupabase } from '@/lib/supabase-client';
import { fixedAssetCreateSchema } from '@/lib/hr-validation';

import type { Row } from '@/lib/types';

export const FIXED_ASSET_COLUMNS = `id,name,code,category,purchase_date,purchase_cost,useful_life_years,
  depreciation_rate,depreciation_method,accumulated_depreciation,net_book_value,status,location,notes,
  journal_entry_id,asset_account_id,depreciation_account_id,approved_at,created_at`;

export async function GET(req: NextRequest) {
  try {
    const auth = await requireModulePermission(req, 'fixed_assets', 'read');
    const { page, pageSize } = getPaginationParams(new URL(req.url));
    const offset = (page - 1) * pageSize;
    const { data, error: queryError, count } = await getSupabase().from('fixed_assets')
      .select(FIXED_ASSET_COLUMNS, { count: 'exact' }).eq('company_id', auth.companyId)
      .order('purchase_date', { ascending: false }).range(offset, offset + pageSize - 1);
    if (queryError) throw queryError;
    const assets = (data || []).map((asset: Row) => ({
      ...asset,
      net_book_value: Number(asset.purchase_cost || 0) - Number(asset.accumulated_depreciation || 0),
    }));
    return success({ assets, total: count || 0, page, pageSize });
  } catch (cause) {
    return handleApiError(cause);
  }
}

export async function POST(req: NextRequest) {
  try {
    const auth = await requireModulePermission(req, 'fixed_assets', 'create');
    const parsed = fixedAssetCreateSchema.safeParse(await parseBody(req));
    if (!parsed.success) return error(parsed.error.issues[0]?.message || 'بيانات الأصل غير صالحة');
    const input = parsed.data;
    const { data, error: rpcError } = await getSupabase().rpc('create_fixed_asset', {
      p_company_id: auth.companyId,
      p_name: input.name,
      p_code: input.code.toUpperCase(),
      p_category: input.category,
      p_purchase_date: input.purchase_date,
      p_purchase_cost: input.purchase_cost,
      p_useful_life_years: input.useful_life_years,
      p_depreciation_method: input.depreciation_method || 'straight_line',
      p_location: input.location || '',
      p_notes: input.notes || '',
      p_bank_safe_id: input.bank_safe_id,
      p_created_by: auth.userId,
      p_salvage_value: input.salvage_value ?? 0,
    });
    if (rpcError) throw rpcError;
    return success(data, 201);
  } catch (cause) {
    return handleApiError(cause);
  }
}
