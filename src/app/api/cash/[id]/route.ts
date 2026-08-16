import { NextRequest } from 'next/server';
import { z } from 'zod';
import { success, error, notFound, requireModulePermission, requireManagerOrAbove, handleApiError, parseBody } from '@/lib/api-helpers';
import { getSupabase } from '@/lib/supabase-client';

const sb = () => getSupabase();
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const updateSchema = z.object({ reason: z.string().trim().min(1, 'البيان غير صالح').max(1000) }).strict();
const COLUMNS = `id, date, type, amount, account_id, bank_safe_id, contact_id, project_id, category_id,
  reason, journal_entry_id, created_by, tax_rate, tax_amount, status, created_at,
  banks_safes!bank_safe_id(name), accounts!account_id(name), contacts!contact_id(name), journal_entries!journal_entry_id(number)`;

export async function GET(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const auth = await requireModulePermission(request, 'cash', 'read');
    const { id } = await params;
    if (!UUID_RE.test(id)) return error('معرّف الحركة غير صالح');
    const { data, error: queryError } = await sb().from('cash_transactions').select(COLUMNS)
      .eq('id', id).eq('company_id', auth.companyId).maybeSingle();
    if (queryError) throw queryError;
    if (!data) return notFound();
    const row = data as Record<string, unknown>;
    return success({
      ...row,
      bank_safe_name: (row.banks_safes as { name?: string } | null)?.name || null,
      account_name: (row.accounts as { name?: string } | null)?.name || null,
      contact_name: (row.contacts as { name?: string } | null)?.name || null,
      journal_entry_number: (row.journal_entries as { number?: number } | null)?.number || null,
      banks_safes: undefined, accounts: undefined, contacts: undefined, journal_entries: undefined,
    });
  } catch (err) {
    return handleApiError(err);
  }
}

export async function PUT(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const auth = await requireModulePermission(request, 'cash', 'update');
    const { id } = await params;
    if (!UUID_RE.test(id)) return error('معرّف الحركة غير صالح');
    const parsed = updateSchema.safeParse(await parseBody(request));
    if (!parsed.success) return error('الحركة المرحلة لا تقبل إلا تعديل البيان؛ اعكسها وسجل حركة جديدة لتغيير القيم المحاسبية');
    const { data, error: updateError } = await sb().rpc('update_cash_transaction_note', {
      p_company_id: auth.companyId, p_transaction_id: id,
      p_reason: parsed.data.reason, p_user_id: auth.userId,
    });
    const message = String(updateError?.message || '');
    if (message.includes('غير موجودة')) return notFound();
    if (message.includes('ملغاة')) return error(message, 409);
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
    if (!UUID_RE.test(id)) return error('معرّف الحركة غير صالح');
    const { data, error: cancelError } = await sb().rpc('cancel_cash_transaction', {
      p_company_id: auth.companyId, p_transaction_id: id, p_user_id: auth.userId,
    });
    const message = String(cancelError?.message || '');
    if (message.includes('غير موجودة')) return notFound();
    if (message.includes('مسبقاً')) return error(message, 409);
    if (cancelError) throw cancelError;
    return success(data);
  } catch (err) {
    return handleApiError(err);
  }
}
