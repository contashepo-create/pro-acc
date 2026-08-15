import { NextRequest } from 'next/server';
import { success, error, parseBody, requireModulePermission, handleApiError } from '@/lib/api-helpers';
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
    if (!/^\d{4}-\d{2}-\d{2}$/.test(date) || !Number.isFinite(Date.parse(date))) return error('تاريخ المطابقة غير صالح');
    if (items !== undefined && (!Array.isArray(items) || items.length > 1000)) return error('بنود المطابقة غير صالحة');
    if (Array.isArray(items) && items.some((item) => !item || typeof item !== 'object'
      || typeof item.transactionType !== 'string' || !item.transactionType.trim() || item.transactionType.length > 100
      || !Number.isFinite(Number(item.amount)) || Number(item.amount) < 0
      || (item.date !== undefined && (!/^\d{4}-\d{2}-\d{2}$/.test(item.date) || !Number.isFinite(Date.parse(item.date))))
      || (item.isCleared !== undefined && typeof item.isCleared !== 'boolean'))) {
      return error('أحد بنود المطابقة غير صالح');
    }

    // Bank lock, ledger snapshot, duplicate-date check, header, items and
    // audit are one transaction; no cleanup-on-error path is needed.
    const { data: rec, error: recErr } = await s.rpc('create_bank_reconciliation', {
      p_company_id: auth.companyId,
      p_bank_safe_id: bankSafeId,
      p_date: date,
      p_closing_balance: normalizedClosingBalance,
      p_items: items || [],
      p_user_id: auth.userId,
    });
    if (recErr) throw recErr;
    return success(rec, 201);
  } catch (err) { return handleApiError(err); }
}
