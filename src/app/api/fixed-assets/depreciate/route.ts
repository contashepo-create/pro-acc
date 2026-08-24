import { NextRequest } from 'next/server';
import { getSupabase } from '@/lib/supabase-client';
import { handleApiError, success, requireModulePermission } from '@/lib/api-helpers';

import type { Row } from '@/lib/types';

const firstDayOfCurrentUtcMonth = () => {
  const now = new Date();
  return new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1)).toISOString().slice(0, 10);
};

/** Posts every eligible asset as one PostgreSQL transaction. A failure in any
 * asset rolls the whole monthly batch back. */
export async function POST(request: NextRequest) {
  try {
    const auth = await requireModulePermission(request, 'fixed_assets', 'update');
    const { data, error: rpcError } = await getSupabase().rpc('depreciate_fixed_assets_batch', {
      p_company_id: auth.companyId,
      p_date: firstDayOfCurrentUtcMonth(),
      p_user_id: auth.userId,
    });
    if (rpcError) throw rpcError;
    const result = data as Row;
    return success({
      ...result,
      message: `تم إنشاء ${Number(result.count) || 0} قيد إهلاك بإجمالي ${(Number(result.totalDepreciation) || 0).toFixed(2)}`,
    });
  } catch (cause) {
    return handleApiError(cause);
  }
}

export async function GET(request: NextRequest) {
  try {
    const auth = await requireModulePermission(request, 'fixed_assets', 'update');
    const depreciationDate = firstDayOfCurrentUtcMonth();
    const { data: assets, error: assetError } = await getSupabase().from('fixed_assets')
      .select('id,code,name,purchase_cost,accumulated_depreciation,useful_life_years,depreciation_method,status')
      .eq('company_id', auth.companyId).eq('status', 'active').lte('purchase_date', depreciationDate);
    if (assetError) throw assetError;
    const preview = (assets || []).map((asset: Row) => {
      const purchaseCost = Number(asset.purchase_cost) || 0;
      const remaining = purchaseCost - (Number(asset.accumulated_depreciation) || 0);
      const life = Number.parseInt(String(asset.useful_life_years)) || 5;
      const monthly = asset.depreciation_method === 'straight_line'
        ? purchaseCost / (life * 12) : remaining * ((2 / life) / 12);
      return {
        id: asset.id, code: asset.code, name: asset.name,
        remaining: remaining.toFixed(2), monthly: Math.min(monthly, remaining).toFixed(2),
      };
    });
    return success({ assets: preview, count: preview.length, date: depreciationDate });
  } catch (cause) {
    return handleApiError(cause);
  }
}
