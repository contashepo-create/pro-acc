import { NextRequest } from 'next/server';
import { success, error, parseBody, requireApiAuth, requireModulePermission, handleApiError } from '@/lib/api-helpers';
import { getSupabase } from '@/lib/supabase-client';

const sb = () => getSupabase();

export async function GET(req: NextRequest) {
  try {
    const auth = await requireModulePermission(req, 'banks', 'read');
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
    const auth = await requireModulePermission(req, 'banks', 'create');
    const s = sb();
    const { bankSafeId, date, closingBalance, items } = await parseBody(req);
    if (!bankSafeId || !date || closingBalance === undefined)
      return error('bankSafeId, date, closingBalance are required');
    const normalizedClosingBalance = Number(closingBalance);
    if (!Number.isFinite(normalizedClosingBalance) || Math.abs(normalizedClosingBalance * 100 - Math.round(normalizedClosingBalance * 100)) > 1e-8)
      return error('الرصيد الختامي يجب أن يكون رقماً بمنزلتين عشريتين كحد أقصى');
    if (items !== undefined && !Array.isArray(items)) return error('بنود المطابقة غير صالحة');
    if (Array.isArray(items) && items.some((item) => !item || typeof item !== 'object' || !Number.isFinite(Number(item.amount)) || Number(item.amount) < 0)) {
      return error('أحد بنود المطابقة غير صالح');
    }

    // TENANT CHECK: الخزينة/البنك المطابَق يجب أن ينتمي لهذه الشركة
    const { data: bankSafe } = await s.from('banks_safes')
      .select('id').eq('id', bankSafeId).eq('company_id', auth.companyId).maybeSingle();
    if (!bankSafe) return error('البنك/الخزينة غير موجود', 404);

    const { data: rec, error: recErr } = await s.from('bank_reconciliation')
      .insert({ company_id: auth.companyId, bank_safe_id: bankSafeId, date, closing_balance: parseFloat(closingBalance) })
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
