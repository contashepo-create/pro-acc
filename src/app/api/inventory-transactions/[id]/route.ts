import { NextRequest } from 'next/server';
import { success, error, notFound, requireModulePermission, requireManagerOrAbove, handleApiError, parseBody } from '@/lib/api-helpers';
import { getSupabase } from '@/lib/supabase-client';

const sb = () => getSupabase();

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const auth = await requireModulePermission(request, 'inventory_transactions', 'read');
    const { id } = await params;
    const s = sb();

    const { data: transaction } = await s.from('inventory_transactions')
      .select('*, inventory_items(name, code), warehouses(name)')
      .eq('id', id)
      .eq('company_id', auth.companyId)
      .maybeSingle();

    if (!transaction) return notFound();

    return success(transaction);
  } catch (err) {
    return handleApiError(err);
  }
}

/**
 * PUT /api/inventory-transactions/[id]
 * الحركة المخزنية أثر مالي ومخزني — الكمية/السعر/النوع لا تُعدَّل أبداً
 * (تعديلها بلا إعادة ترحيل يفسد الدفتر مقابل الرصيد). يُسمح فقط بتصحيح
 * الملاحظات والتاريخ. لتصحيح كمية: سجّل حركة عكسية ثم حركة صحيحة.
 */
export async function PUT(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const auth = await requireModulePermission(request, 'inventory_transactions', 'update');
    const { id } = await params;
    const s = sb();
    const body = await parseBody<Record<string, unknown>>(request);

    const { data: existing } = await s.from('inventory_transactions')
      .select('id')
      .eq('id', id)
      .eq('company_id', auth.companyId)
      .maybeSingle();

    if (!existing) return notFound();

    if (
      body.quantity !== undefined || body.unit_price !== undefined ||
      body.total_value !== undefined || body.type !== undefined || body.item_id !== undefined
    ) {
      return error('لا يمكن تعديل كمية/سعر/نوع حركة مسجلة — سجّل حركة عكسية ثم حركة صحيحة');
    }

    const updateData: any = {};
    if (body.date !== undefined) updateData.date = body.date;
    if (body.notes !== undefined) updateData.notes = body.notes;
    if (Object.keys(updateData).length === 0) return error('لا يوجد ما يمكن تعديله');

    const { data: updated, error: updateErr } = await s.from('inventory_transactions')
      .update(updateData)
      .eq('id', id)
      .eq('company_id', auth.companyId)
      .select('*')
      .single();

    if (updateErr) throw updateErr;

    return success(updated);
  } catch (err) {
    return handleApiError(err);
  }
}

/**
 * DELETE /api/inventory-transactions/[id]
 * محظور: حذف حركة أثّرت على الرصيد والدفاتر بلا أثر عكسي هو الفساد بعينه.
 * البديل المحاسبي: حركة عكسية (issue↔return)، أو تسوية جرد.
 */
export async function DELETE(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const auth = await requireManagerOrAbove(request);
    const { id } = await params;
    const s = sb();

    const { data: existing } = await s.from('inventory_transactions')
      .select('id')
      .eq('id', id)
      .eq('company_id', auth.companyId)
      .maybeSingle();

    if (!existing) return notFound();

    return error('الحركات المخزنية لا تُحذف — سجّل حركة عكسية (مرتجع/صرف) أو تسوية جرد للتصحيح');
  } catch (err) {
    return handleApiError(err);
  }
}
