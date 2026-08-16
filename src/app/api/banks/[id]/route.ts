import { NextRequest } from 'next/server';
import { z } from 'zod';
import { success, error, notFound, requireModulePermission, requireManagerOrAbove, handleApiError, parseBody } from '@/lib/api-helpers';
import { getSupabase } from '@/lib/supabase-client';

const sb = () => getSupabase();
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const money = z.number().finite().refine((value) => Math.abs(value * 100 - Math.round(value * 100)) < 1e-8,
  'الرصيد الافتتاحي يجب ألا يتجاوز منزلتين');
const updateSchema = z.object({
  name: z.string().trim().min(1, 'اسم البنك/الخزينة غير صالح').max(200).optional(),
  account_number: z.string().trim().max(100).nullable().optional(),
  type: z.enum(['bank', 'safe']).optional(),
  opening_balance: money.optional(),
}).strict();
const COLUMNS = 'id, name, type, account_number, account_id, opening_balance, opening_journal_entry_id, is_active, created_at, updated_at, accounts!account_id(code, name)';

async function loadBank(companyId: string, id: string) {
  return sb().from('banks_safes').select(COLUMNS).eq('id', id).eq('company_id', companyId).maybeSingle();
}

export async function GET(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const auth = await requireModulePermission(request, 'banks', 'read');
    const { id } = await params;
    if (!UUID_RE.test(id)) return error('معرّف البنك أو الخزينة غير صالح');
    const { data, error: queryError } = await loadBank(auth.companyId, id);
    if (queryError) throw queryError;
    if (!data) return notFound();
    const { data: balances, error: balanceError } = await sb().rpc('get_bank_safe_balances', {
      p_company_id: auth.companyId, p_bank_safe_ids: [id],
    });
    if (balanceError) throw balanceError;
    const balance = Number((balances || [])[0]?.current_balance) || 0;
    const opening = Number((balances || [])[0]?.opening_balance) || 0;
    const row = data as Record<string, unknown>;
    return success({
      ...row,
      account_code: (row.accounts as { code?: string } | null)?.code || null,
      account_name: (row.accounts as { name?: string } | null)?.name || null,
      accounts: undefined,
      configured_opening_balance: Number(row.opening_balance) || 0,
      opening_balance: opening,
      current_balance: balance,
      balance,
    });
  } catch (err) {
    return handleApiError(err);
  }
}

export async function PUT(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const auth = await requireModulePermission(request, 'banks', 'update');
    const { id } = await params;
    if (!UUID_RE.test(id)) return error('معرّف البنك أو الخزينة غير صالح');
    const parsed = updateSchema.safeParse(await parseBody(request));
    if (!parsed.success) return error(parsed.error.issues[0].message);
    const { data: current, error: currentError } = await sb().from('banks_safes')
      .select('id, type, opening_balance').eq('id', id).eq('company_id', auth.companyId).maybeSingle();
    if (currentError) throw currentError;
    if (!current) return notFound();
    if (parsed.data.type !== undefined && parsed.data.type !== current.type) {
      return error('لا يمكن تغيير نوع البنك/الخزينة بعد إنشاء حسابه المحاسبي', 409);
    }
    if (parsed.data.opening_balance !== undefined && Number(parsed.data.opening_balance) !== Number(current.opening_balance || 0)) {
      return error('الرصيد الافتتاحي المرحّل غير قابل للتعديل؛ استخدم قيد تصحيح عكسياً', 409);
    }
    const patch: Record<string, unknown> = {};
    if (parsed.data.name !== undefined) patch.name = parsed.data.name;
    if (parsed.data.account_number !== undefined) patch.account_number = parsed.data.account_number;
    if (!Object.keys(patch).length) return error('لا توجد حقول قابلة للتعديل');
    const { data, error: updateError } = await sb().rpc('update_bank_safe_metadata_atomic', {
      p_company_id: auth.companyId, p_bank_safe_id: id, p_patch: patch, p_user_id: auth.userId,
    });
    const message = String(updateError?.message || '');
    if (message.includes('غير موجود')) return notFound();
    if (message.includes('مستخدم مسبقاً')) return error(message, 409);
    if (updateError) throw updateError;
    return success(data);
  } catch (err) {
    return handleApiError(err);
  }
}

export async function DELETE(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const auth = await requireManagerOrAbove(request);
    const { id } = await params;
    if (!UUID_RE.test(id)) return error('معرّف البنك أو الخزينة غير صالح');
    const { data, error: deactivateError } = await sb().rpc('deactivate_bank_safe', {
      p_company_id: auth.companyId, p_bank_safe_id: id, p_user_id: auth.userId,
    });
    const message = String(deactivateError?.message || '');
    if (message.includes('غير موجود')) return notFound();
    if (message.includes('رصيد غير صفري')) return error(message, 409);
    if (deactivateError) throw deactivateError;
    return success({ deactivated: true, bank: data });
  } catch (err) {
    return handleApiError(err);
  }
}
