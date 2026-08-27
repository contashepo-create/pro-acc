import { NextRequest } from 'next/server';
import { z } from 'zod';
import { success, error, notFound, requireManagerOrAbove, handleApiError, requireModulePermission, parseBody } from '@/lib/api-helpers';
import { getSupabase } from '@/lib/supabase-client';

const sb = () => getSupabase();
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const updateSchema = z.object({
  closingBalance: z.number().finite()
    .refine((value) => Math.abs(value * 100 - Math.round(value * 100)) < 1e-8, 'الرصيد الختامي غير صالح')
    .optional(),
  status: z.literal('completed').optional(),
}).strict();
const COLUMNS = 'id, number, bank_safe_id, date, closing_balance, system_balance, difference, status, created_by, completed_by, completed_at, created_at';
const ITEM_COLUMNS = 'id, reconciliation_id, transaction_type, amount, date, is_cleared';

export async function GET(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const auth = await requireModulePermission(req, 'banks', 'read');
    const { id } = await params;
    if (!UUID_RE.test(id)) return error('معرّف المطابقة غير صالح');
    const { data, error: queryError } = await sb().from('bank_reconciliation').select(COLUMNS)
      .eq('id', id).eq('company_id', auth.companyId).maybeSingle();
    if (queryError) throw queryError;
    if (!data) return notFound();
    const { data: items, error: itemsError } = await sb().from('bank_reconciliation_items').select(ITEM_COLUMNS)
      .eq('reconciliation_id', id).eq('company_id', auth.companyId).order('date').order('id');
    if (itemsError) throw itemsError;
    return success({ ...data, items: items || [] });
  } catch (err) {
    return handleApiError(err);
  }
}

export async function PUT(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const auth = await requireModulePermission(req, 'banks', 'update');
    const { id } = await params;
    if (!UUID_RE.test(id)) return error('معرّف المطابقة غير صالح');
    const parsed = updateSchema.safeParse(await parseBody(req));
    if (!parsed.success) return error(parsed.error.issues[0].message);
    if (!Object.keys(parsed.data).length) return error('لا توجد حقول قابلة للتعديل');
    const { data, error: updateError } = await sb().rpc('update_bank_reconciliation', {
      p_company_id: auth.companyId,
      p_reconciliation_id: id,
      p_closing_balance: parsed.data.closingBalance ?? null,
      p_complete: parsed.data.status === 'completed',
      p_user_id: auth.userId,
    });
    const message = String(updateError?.message || '');
    if (message.includes('غير موجودة')) return notFound();
    if (message.includes('المكتملة')) return error(message, 409);
    if (updateError) throw updateError;
    return success(data);
  } catch (err) {
    return handleApiError(err);
  }
}

export async function DELETE(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const auth = await requireManagerOrAbove(req);
    const { id } = await params;
    if (!UUID_RE.test(id)) return error('معرّف المطابقة غير صالح');
    const { error: deleteError } = await sb().rpc('delete_pending_bank_reconciliation', {
      p_company_id: auth.companyId, p_reconciliation_id: id, p_user_id: auth.userId,
    });
    const message = String(deleteError?.message || '');
    if (message.includes('غير موجودة')) return notFound();
    if (message.includes('مكتملة')) return error(message, 409);
    if (deleteError) throw deleteError;
    return success({ deleted: true });
  } catch (err) {
    return handleApiError(err);
  }
}
