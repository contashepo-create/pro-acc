import { NextRequest } from 'next/server';
import { z } from 'zod';
import { success, error, notFound, requireModulePermission, handleApiError, parseBody } from '@/lib/api-helpers';
import { getSupabase } from '@/lib/supabase-client';

const sb = () => getSupabase();
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const updateSchema = z.object({ notes: z.string().trim().max(500).nullable() }).strict();
const COLUMNS = 'id, item_id, warehouse_id, to_warehouse_id, type, quantity, unit_price, total_value, balance_before, balance_after, reference_type, reference_id, project_id, notes, date, created_by, created_at, inventory_items!item_id(name, code), warehouses!warehouse_id(name)';

export async function GET(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const auth = await requireModulePermission(request, 'inventory_transactions', 'read');
    const { id } = await params;
    if (!UUID_RE.test(id)) return error('معرّف الحركة غير صالح');
    const { data, error: queryError } = await sb().from('inventory_transactions').select(COLUMNS)
      .eq('id', id).eq('company_id', auth.companyId).maybeSingle();
    if (queryError) throw queryError;
    if (!data) return notFound();
    return success(data);
  } catch (err) {
    return handleApiError(err);
  }
}

export async function PUT(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const auth = await requireModulePermission(request, 'inventory_transactions', 'update');
    const { id } = await params;
    if (!UUID_RE.test(id)) return error('معرّف الحركة غير صالح');
    const parsed = updateSchema.safeParse(await parseBody(request));
    if (!parsed.success) return error('لا يمكن تعديل أثر الحركة؛ يُسمح بالملاحظات فقط، وللقيم سجّل حركة عكسية');
    const { data, error: updateError } = await sb().rpc('update_inventory_transaction_note_atomic', {
      p_company_id: auth.companyId,
      p_transaction_id: id,
      p_notes: parsed.data.notes || '',
      p_user_id: auth.userId,
    });
    if (updateError && String(updateError.message || '').includes('الحركة غير موجودة')) return notFound();
    if (updateError) throw updateError;
    return success(data);
  } catch (err) {
    return handleApiError(err);
  }
}

export async function DELETE(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const auth = await requireModulePermission(request, 'inventory_transactions', 'delete');
    const { id } = await params;
    if (!UUID_RE.test(id)) return error('معرّف الحركة غير صالح');
    const { data, error: queryError } = await sb().from('inventory_transactions').select('id')
      .eq('id', id).eq('company_id', auth.companyId).maybeSingle();
    if (queryError) throw queryError;
    if (!data) return notFound();
    return error('الحركة المخزنية لا تُحذف أو تُعدّل مالياً؛ سجّل حركة عكسية موثقة للتصحيح', 409);
  } catch (err) {
    return handleApiError(err);
  }
}
