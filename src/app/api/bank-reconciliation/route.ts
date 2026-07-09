import { NextRequest } from 'next/server';
import { success, error, parseBody, requireApiAuth, handleApiError } from '@/lib/api-helpers';
import { getSupabase } from '@/lib/supabase-client';

// @ts-ignore
const sb = () => getSupabase() as any;

export async function GET(req: NextRequest) {
  try {
    const auth = await requireApiAuth(req);
    const s = sb();
    const { data, error: queryError } = await s.from('bank_reconciliation')
      .select('*, banks_safes(name)').eq('company_id', auth.companyId).order('date', { ascending: false });
    if (queryError) throw queryError;

    const reconciliations = (data || []).map((r: any) => ({ ...r, bank_safe_name: r.banks_safes?.name || null }));
    return success(reconciliations);
  } catch (err) { return handleApiError(err); }
}

export async function POST(req: NextRequest) {
  try {
    const auth = await requireApiAuth(req);
    const s = sb();
    const { bankSafeId, date, closingBalance, items } = await parseBody(req);
    if (!bankSafeId || !date || closingBalance === undefined)
      return error('bankSafeId, date, closingBalance are required');

    const { data: rec, error: recErr } = await s.from('bank_reconciliation')
      .insert({ company_id: auth.companyId, bank_safe_id: bankSafeId, date, closing_balance: closingBalance })
      .select('*').single();
    if (recErr) throw recErr;

    if (items && items.length > 0) {
      for (const item of items) {
        await s.from('bank_reconciliation_items').insert({
          company_id: auth.companyId, reconciliation_id: rec.id,
          transaction_type: item.transactionType, amount: item.amount,
          date: item.date ?? date, is_cleared: item.isCleared ?? false,
        });
      }
    }
    return success(rec);
  } catch (err) { return handleApiError(err); }
}
