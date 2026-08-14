import { NextRequest } from 'next/server';
import { success, error, notFound, requireManagerOrAbove, handleApiError, requireModulePermission, parseBody } from '@/lib/api-helpers';
import { getSupabase } from '@/lib/supabase-client';

const sb = () => getSupabase();

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const auth = await requireModulePermission(request, 'employee_advances', 'read');
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
    const body = await parseBody<Record<string, unknown>>(request);

    const { data: existing } = await s.from('employee_advances')
      .select('id, journal_entry_id')
      .eq('id', id)
      .eq('company_id', auth.companyId)
      .maybeSingle();

    if (!existing) return notFound();
    if ((existing as Record<string, any>).journal_entry_id &&
        (body.amount !== undefined || body.remaining_amount !== undefined || body.date !== undefined)) {
      return error('لا يمكن تعديل القيم المالية لسلفة مُرحّلة؛ أنشئ قيداً عكسياً وتسوية جديدة');
    }

    const updateData: any = {};
    if (body.amount !== undefined) updateData.amount = body.amount;
    if (body.remaining_amount !== undefined) updateData.remaining_amount = body.remaining_amount;
    if (body.date !== undefined) updateData.date = body.date;
    if (body.reason !== undefined) updateData.reason = body.reason;

    const { data: updated, error: updateErr } = await s.from('employee_advances')
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

export async function DELETE(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const auth = await requireManagerOrAbove(request);
    const { id } = await params;
    const s = sb();

    const { data: existing } = await s.from('employee_advances')
      .select('id, remaining_amount, amount, journal_entry_id')
      .eq('id', id)
      .eq('company_id', auth.companyId)
      .maybeSingle();

    if (!existing) return notFound();

    // Posted advances are financial history; deleting them would leave the
    // original debit/credit or payroll settlement without a source document.
    if ((existing as Record<string, any>).journal_entry_id) {
      return error('لا يمكن حذف سلفة مُرحّلة؛ استخدم تسوية أو قيداً عكسياً');
    }
    // Check if advance has been partially settled
    if ((existing as any).remaining_amount < (existing as any).amount) {
      return error('لا يمكن حذف السلفة لأنها تم تسويتها جزئياً');
    }

    await s.from('employee_advances').delete().eq('id', id).eq('company_id', auth.companyId);

    return success({ deleted: true });
  } catch (err) {
    return handleApiError(err);
  }
}
