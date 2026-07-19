import { NextRequest } from 'next/server';
import { success, error, notFound, requireApiAuth, requireManagerOrAbove, handleApiError } from '@/lib/api-helpers';
import { getSupabase } from '@/lib/supabase-client';

const sb = () => getSupabase();

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const auth = await requireApiAuth(request);
    const { id } = await params;
    const s = sb();

    const { data: custody } = await s.from('custodies')
      .select('*, employees(name), banks_safes(name)')
      .eq('id', id)
      .eq('company_id', auth.companyId)
      .maybeSingle();

    if (!custody) return notFound();

    return success(custody);
  } catch (err) {
    return handleApiError(err);
  }
}

export async function PUT(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const auth = await requireManagerOrAbove(request);
    const { id } = await params;
    const s = sb();
    const body = await request.json();

    const { data: existing } = await s.from('custodies')
      .select('id, status')
      .eq('id', id)
      .eq('company_id', auth.companyId)
      .maybeSingle();

    if (!existing) return notFound();

    if ((existing as any).status === 'settled') {
      return error('لا يمكن تعديل عهدة تم تسويتها');
    }

    const updateData: any = {};
    if (body.employee_id !== undefined) updateData.employee_id = body.employee_id;
    if (body.amount !== undefined) updateData.amount = body.amount;
    if (body.date !== undefined) updateData.date = body.date;
    if (body.bank_safe_id !== undefined) updateData.bank_safe_id = body.bank_safe_id;
    if (body.description !== undefined) updateData.description = body.description;
    if (body.status !== undefined) updateData.status = body.status;

    const { data: updated, error: updateErr } = await s.from('custodies')
      .update(updateData)
      .eq('id', id)
      .select('*')
      .single();

    if (updateErr) throw updateErr;

    return success(updated);
  } catch (err) {
    return handleApiError(err);
  }
}

export async function DELETE(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const auth = await requireManagerOrAbove(request);
    const { id } = await params;
    const s = sb();

    const { data: existing } = await s.from('custodies')
      .select('id, status')
      .eq('id', id)
      .eq('company_id', auth.companyId)
      .maybeSingle();

    if (!existing) return notFound();

    if ((existing as any).status === 'settled') {
      return error('لا يمكن حذف عهدة تم تسويتها');
    }

    // Check if custody has settlements
    const { data: settlements } = await s.from('custody_settlements')
      .select('id')
      .eq('custody_id', id)
      .limit(1);

    if (settlements && settlements.length > 0) {
      return error('لا يمكن حذف العهدة لأنها تحتوي على تسويات');
    }

    await s.from('custodies').delete().eq('id', id);

    return success({ deleted: true });
  } catch (err) {
    return handleApiError(err);
  }
}
