import { NextRequest } from 'next/server';
import { z } from 'zod';
import { success, error, parseBody, getPaginationParams, requireModulePermission, handleApiError } from '@/lib/api-helpers';
import { getSupabase } from '@/lib/supabase-client';

const sb = () => getSupabase();
const money = z.number().finite().refine((value) => Math.abs(value * 100 - Math.round(value * 100)) < 1e-8,
  'الرصيد الافتتاحي يجب ألا يتجاوز منزلتين');
const createSchema = z.object({
  name: z.string().trim().min(1, 'اسم الخزينة/البنك مطلوب').max(200),
  type: z.enum(['bank', 'safe'], { message: 'النوع يجب أن يكون بنكاً أو خزينة' }),
  account_number: z.string().trim().max(100).nullable().optional(),
  opening_balance: money.optional().default(0),
}).strict();
const COLUMNS = 'id, name, type, account_number, account_id, opening_balance, opening_journal_entry_id, is_active, created_at, updated_at, accounts!account_id(code, name)';

export async function GET(request: NextRequest) {
  try {
    const auth = await requireModulePermission(request, 'banks', 'read');
    const { page, pageSize } = getPaginationParams(request.url);
    const offset = (page - 1) * pageSize;
    const { data, error: queryError, count } = await sb().from('banks_safes')
      .select(COLUMNS, { count: 'exact' }).eq('company_id', auth.companyId)
      .order('type').order('name').range(offset, offset + pageSize - 1);
    if (queryError) throw queryError;
    const ids = (data || []).map((row) => row.id);
    const { data: balances, error: balanceError } = ids.length
      ? await sb().rpc('get_bank_safe_balances', { p_company_id: auth.companyId, p_bank_safe_ids: ids })
      : { data: [], error: null };
    if (balanceError) throw balanceError;
    const balanceMap = new Map((balances || []).map((row: Record<string, unknown>) => [
      String(row.bank_safe_id), Number(row.current_balance) || 0,
    ]));
    const banks = (data || []).map((value: Record<string, unknown>) => ({
      ...value,
      account_code: (value.accounts as { code?: string } | null)?.code || null,
      account_name: (value.accounts as { name?: string } | null)?.name || null,
      accounts: undefined,
      configured_opening_balance: Number(value.opening_balance) || 0,
      opening_balance: Number(value.opening_balance) || 0,
      current_balance: balanceMap.get(String(value.id)) || 0,
      balance: balanceMap.get(String(value.id)) || 0,
    }));
    return success({ banks, total: count || 0, page, pageSize });
  } catch (err) {
    return handleApiError(err);
  }
}

export async function POST(request: NextRequest) {
  try {
    const auth = await requireModulePermission(request, 'banks', 'create');
    const parsed = createSchema.safeParse(await parseBody(request));
    if (!parsed.success) return error(parsed.error.issues[0].message);
    const value = parsed.data;
    const { data, error: createError } = await sb().rpc('create_bank_safe', {
      p_company_id: auth.companyId,
      p_name: value.name,
      p_type: value.type,
      p_account_number: value.account_number || '',
      p_opening_balance: value.opening_balance,
      p_user_id: auth.userId,
    });
    if (createError?.code === '23505') return error('اسم البنك أو الخزينة مستخدم مسبقاً', 409);
    if (createError) throw createError;
    return success(data, 201);
  } catch (err) {
    return handleApiError(err);
  }
}
