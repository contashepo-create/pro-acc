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

    const { data: advance } = await s.from('employee_advances')
      .select('*, employees(name)')
      .eq('id', id)
      .eq('company_id', auth.companyId)
      .maybeSingle();

    if (!advance) return notFound();

    return success(advance);
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

    const { data: existing } = await s.from('employee_advances')
      .select('id')
      .eq('id', id)
      .eq('company_id', auth.companyId)
      .maybeSingle();

    if (!existing) return notFound();

    const updateData: any = {};
    if (body.amount !== undefined) updateData.amount = body.amount;
    if (body.remaining_amount !== undefined) updateData.remaining_amount = body.remaining_amount;
    if (body.date !== undefined) updateData.date = body.date;
    if (body.reason !== undefined) updateData.reason = body.reason;

    const { data: updated, error: updateErr } = await s.from('employee_advances')
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

    const { data: existing } = await s.from('employee_advances')
      .select('id, remaining_amount, amount')
      .eq('id', id)
      .eq('company_id', auth.companyId)
      .maybeSingle();

    if (!existing) return notFound();

    // Check if advance has been partially settled
    if ((existing as any).remaining_amount < (existing as any).amount) {
      return error('لا يمكن حذف السلفة لأنها تم تسويتها جزئياً');
    }

    await s.from('employee_advances').delete().eq('id', id);

    return success({ deleted: true });
  } catch (err) {
    return handleApiError(err);
  }
}
