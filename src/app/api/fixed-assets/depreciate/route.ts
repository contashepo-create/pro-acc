import { NextRequest } from 'next/server';
import { getSupabase } from '@/lib/supabase-client';
import { error, handleApiError, success, requireModulePermission } from '@/lib/api-helpers';

// @ts-ignore
const sb = () => getSupabase() as any;

export async function POST(request: NextRequest) {
  try {
    const auth = await requireModulePermission(request, 'fixed_assets', 'update');
    const s = sb();
    const now = new Date();
    const depreciationDate = new Date(Date.UTC(now.getUTCFullYear(),now.getUTCMonth(),1)).toISOString().slice(0,10);
    const { data: expenseAccount } = await s.from('accounts').select('id')
      .eq('company_id',auth.companyId).eq('code','5260').eq('is_header',false).maybeSingle();
    if (!expenseAccount) return error('حساب مصروف الإهلاك (5260) غير موجود أو حساب رئيسي');
    const { data: assets, error: assetError } = await s.from('fixed_assets').select('id, code')
      .eq('company_id',auth.companyId).eq('status','active').lte('purchase_date',depreciationDate);
    if (assetError) throw assetError;
    let totalDepreciation=0;
    const entries:any[]=[];
    for (const asset of assets||[]) {
      const { data, error: depreciationError } = await s.rpc('depreciate_fixed_asset',{
        p_company_id:auth.companyId,p_asset_id:asset.id,p_date:depreciationDate,
        p_expense_account_id:expenseAccount.id,p_user_id:auth.userId,
      });
      if (depreciationError) throw depreciationError;
      if (data?.status==='created') {
        const amount=Number(data.amount)||0; totalDepreciation+=amount;
        entries.push({asset:asset.code,amount,journal_id:data.journal_id});
      }
    }
    const { error: auditError } = await s.from('financial_audit_log').insert({
      company_id:auth.companyId,user_id:auth.userId,action:'auto_depreciation',table_name:'fixed_assets',
      new_values:{date:depreciationDate,total:totalDepreciation,count:entries.length},
    });
    if (auditError) console.error('Depreciation audit write failed:',auditError);
    return success({
      message:`تم إنشاء ${entries.length} قيد إهلاك بإجمالي ${totalDepreciation.toFixed(2)}`,
      totalDepreciation,count:entries.length,entries,date:depreciationDate,
    });
  } catch (err) { return handleApiError(err); }
}

// GET to check what would be depreciated
export async function GET(request: NextRequest) {
  try {
    const auth = await requireModulePermission(request, 'fixed_assets', 'update');
    const s = sb();

    const depreciationDate = new Date(Date.UTC(new Date().getUTCFullYear(), new Date().getUTCMonth(), 1)).toISOString().slice(0, 10);
    const { data: assets, error: assetError } = await s.from('fixed_assets')
      .select('id, code, name, purchase_cost, accumulated_depreciation, useful_life_years, depreciation_method, status')
      .eq('company_id', auth.companyId)
      .eq('status', 'active')
      .lte('purchase_date', depreciationDate);
    if (assetError) throw assetError;

    const preview = (assets || []).map((a: any) => {
      const remaining = (parseFloat(a.purchase_cost) || 0) - (parseFloat(a.accumulated_depreciation) || 0);
      const monthly = a.depreciation_method === 'straight_line' 
        ? (parseFloat(a.purchase_cost) || 0) / ((parseInt(a.useful_life_years) || 5) * 12)
        : remaining * ((2 / (parseInt(a.useful_life_years) || 5)) / 12);
      return {
        code: a.code,
        name: a.name,
        remaining: remaining.toFixed(2),
        monthly: Math.min(monthly, remaining).toFixed(2),
      };
    });

    return success({ assets: preview, count: preview.length });
  } catch (err) {
    return handleApiError(err);
  }
}
