import { NextRequest } from 'next/server';
import { success, error, parseBody, getPaginationParams, requireApiAuth, handleApiError } from '@/lib/api-helpers';
import { getSupabase } from '@/lib/supabase-client';
import { ACCOUNT_CODES } from '@/lib/constants';

// @ts-ignore
const sb = () => getSupabase() as any;

export async function GET(req: NextRequest) {
  try {
    const auth = await requireApiAuth(req);
    const s = sb();
    const url = new URL(req.url);
    const { page, pageSize } = getPaginationParams(url);

    const offset = (page - 1) * pageSize;
    const { data, error: queryError, count } = await s.from('fixed_assets')
      .select('*', { count: 'exact' }).eq('company_id', auth.companyId)
      .order('purchase_date', { ascending: false }).range(offset, offset + pageSize - 1);
    if (queryError) throw queryError;

    const assets = (data || []).map((f: any) => ({ ...f, net_book_value: (f.purchase_cost || 0) - (f.accumulated_depreciation || 0) }));
    return success({ assets, total: count || 0, page, pageSize });
  } catch (err) { return handleApiError(err); }
}

export async function POST(req: NextRequest) {
  try {
    const auth = await requireApiAuth(req);
    const s = sb();
    const data = await parseBody(req);
    const { name, code, category, purchase_date, purchase_cost, useful_life_years, depreciation_method, location, notes } = data;
    if (!name || !code || !category || !purchase_date || !purchase_cost || !useful_life_years)
      return error('name, code, category, purchase_date, purchase_cost, useful_life_years are required');

    const rate = depreciation_method === 'declining_balance' ? (2 / useful_life_years) : (1 / useful_life_years);

    const { data: asset, error: assetErr } = await s.from('fixed_assets')
      .insert({ company_id: auth.companyId, name, code, category, purchase_date, purchase_cost, useful_life_years, depreciation_rate: rate, depreciation_method: depreciation_method || 'straight_line', accumulated_depreciation: 0, status: 'active', location: location || null, notes: notes || null })
      .select('*').single();
    if (assetErr) throw assetErr;

    const { data: assetAcc } = await s.from('accounts').select('id').eq('company_id', auth.companyId).eq('code', ACCOUNT_CODES.FIXED_ASSETS_START).maybeSingle();
    const { data: bankAcc } = await s.from('accounts').select('id').eq('company_id', auth.companyId).eq('code', ACCOUNT_CODES.BANKS).maybeSingle();

    if (assetAcc) {
      const { data: maxJe } = await s.from('journal_entries').select('number').eq('company_id', auth.companyId).order('number', { ascending: false }).limit(1).maybeSingle();
      const jeNum = ((maxJe as any)?.number || 0) + 1;
      const { data: je } = await s.from('journal_entries')
        .insert({ company_id: auth.companyId, number: jeNum, date: purchase_date, type: 'general', description: `شراء أصل ثابت: ${name}`, created_by: auth.userId })
        .select('id').single();
      const jl: any[] = [{ journal_entry_id: je.id, account_id: assetAcc.id, debit: purchase_cost, credit: 0 }];
      if (bankAcc) jl.push({ journal_entry_id: je.id, account_id: bankAcc.id, debit: 0, credit: purchase_cost });
      await s.from('journal_lines').insert(jl);
    }
    return success(asset, 201);
  } catch (err) { return handleApiError(err); }
}
