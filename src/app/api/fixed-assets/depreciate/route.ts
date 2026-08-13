import { NextRequest } from 'next/server';
import { getSupabase } from '@/lib/supabase-client';
import { error, handleApiError, success, requireModulePermission } from '@/lib/api-helpers';
import { getNextJournalNumber } from '@/lib/numbering';
import { insertJournalLines } from '@/lib/journal-utils';

// @ts-ignore
const sb = () => getSupabase() as any;

export async function POST(request: NextRequest) {
  try {
    const auth = await requireModulePermission(request, 'fixed_assets', 'update');
    const s = sb();

    const { data: assets, error: assetsErr } = await s.from('fixed_assets')
      .select('*')
      .eq('company_id', auth.companyId)
      .eq('status', 'active');

    if (assetsErr) throw assetsErr;

    const now = new Date();
    const currentMonth = now.getMonth();
    const currentYear = now.getFullYear();
    const depreciationDate = new Date(currentYear, currentMonth, 1).toISOString().split('T')[0];

    // حل حسابي الإهلاك قبل أي كتابة — لا إهلاك بلا قيد متوازن
    const { data: depExpAcc } = await s.from('accounts')
      .select('id').eq('company_id', auth.companyId).eq('code', '5260').maybeSingle();
    const { data: accumAcc } = await s.from('accounts')
      .select('id').eq('company_id', auth.companyId).eq('code', '1290').maybeSingle();
    if (!depExpAcc || !accumAcc) {
      return error('حسابا الإهلاك (5260) ومجمع الإهلاك (1290) غير موجودين — راجع دليل الحسابات');
    }

    let totalDepreciation = 0;
    const createdEntries: any[] = [];

    for (const asset of assets || []) {
      // Check if already depreciated this month
      const { data: existing } = await s.from('depreciation_log')
        .select('id')
        .eq('asset_id', asset.id)
        .eq('date', depreciationDate)
        .maybeSingle();

      if (existing) continue; // Already depreciated this month

      const purchaseCost = parseFloat(asset.purchase_cost) || 0;
      const usefulLife = parseInt(asset.useful_life_years) || 5;
      const accumulated = parseFloat(asset.accumulated_depreciation) || 0;
      const remaining = purchaseCost - accumulated;

      if (remaining <= 0) {
        // Fully depreciated
        await s.from('fixed_assets').update({ status: 'fully_depreciated' }).eq('id', asset.id).eq('company_id', auth.companyId);
        continue;
      }

      let monthlyDepreciation = 0;
      if (asset.depreciation_method === 'straight_line') {
        monthlyDepreciation = purchaseCost / (usefulLife * 12);
      } else {
        // Declining balance: 2 * straight-line rate
        const rate = (2 / usefulLife) / 12;
        monthlyDepreciation = remaining * rate;
      }

      monthlyDepreciation = Math.min(monthlyDepreciation, remaining);
      if (monthlyDepreciation <= 0) continue;

      // Create journal entry for this asset depreciation
      const jeNumber = await getNextJournalNumber(auth.companyId, depreciationDate);
      const { data: je } = await s.from('journal_entries')
        .insert({
          company_id: auth.companyId,
          number: jeNumber,
          date: depreciationDate,
          type: 'general',
          description: `إهلاك أصل ثابت: ${asset.name} (${asset.code}) - ${currentYear}/${currentMonth + 1}`,
          created_by: auth.userId,
        })
        .select('id')
        .single();

      // حسابات الإهلاك حُلَّت قبل الحلقة — القيد هنا إلزامي
      const { error: jlErr } = await insertJournalLines(auth.companyId, [
        { journal_entry_id: je.id, account_id: depExpAcc.id, debit: monthlyDepreciation, credit: 0, description: `إهلاك ${asset.code}` },
        { journal_entry_id: je.id, account_id: accumAcc.id, debit: 0, credit: monthlyDepreciation, description: `مجمع إهلاك ${asset.code}` },
      ]);
      if (jlErr) throw jlErr;

      // Update asset
      await s.from('fixed_assets').update({
        accumulated_depreciation: accumulated + monthlyDepreciation,
        net_book_value: purchaseCost - (accumulated + monthlyDepreciation),
      }).eq('id', asset.id).eq('company_id', auth.companyId);

      // Log depreciation
      await s.from('depreciation_log').insert({
        company_id: auth.companyId,
        asset_id: asset.id,
        date: depreciationDate,
        amount: monthlyDepreciation,
        journal_entry_id: je.id,
      });

      totalDepreciation += monthlyDepreciation;
      createdEntries.push({ asset: asset.code, amount: monthlyDepreciation, journal_id: je.id });
    }

    // Audit log
    await s.from('financial_audit_log').insert({
      company_id: auth.companyId,
      user_id: auth.userId,
      action: 'auto_depreciation',
      table_name: 'fixed_assets',
      new_values: { date: depreciationDate, total: totalDepreciation, count: createdEntries.length },
    });

    return success({
      message: `تم إنشاء ${createdEntries.length} قيد إهلاك بإجمالي ${totalDepreciation.toFixed(2)}`,
      totalDepreciation,
      count: createdEntries.length,
      entries: createdEntries,
      date: depreciationDate,
    });
  } catch (err) {
    return handleApiError(err);
  }
}

// GET to check what would be depreciated
export async function GET(request: NextRequest) {
  try {
    const auth = await requireModulePermission(request, 'fixed_assets', 'update');
    const s = sb();

    const { data: assets } = await s.from('fixed_assets')
      .select('id, code, name, purchase_cost, accumulated_depreciation, useful_life_years, depreciation_method, status')
      .eq('company_id', auth.companyId)
      .eq('status', 'active');

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
