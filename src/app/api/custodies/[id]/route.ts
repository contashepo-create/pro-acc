import { NextRequest } from 'next/server';
import { success, error, notFound, requireApiAuth, requireModulePermission, requireManagerOrAbove, handleApiError } from '@/lib/api-helpers';
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

    const { data: custody, error: custodyErr } = await s.from('custodies')
      .select('*, employees(name)')
      .eq('id', id)
      .eq('company_id', auth.companyId)
      .maybeSingle();

    if (custodyErr) {
      console.error('Custody GET error:', custodyErr);
      throw custodyErr;
    }

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
    const body = await parseBodySafe(request);

    const { data: existing } = await s.from('custodies')
      .select('id, status, amount')
      .eq('id', id)
      .eq('company_id', auth.companyId)
      .maybeSingle();

    if (!existing) return notFound();

    if ((existing as any).status === 'settled') {
      return error('لا يمكن تعديل عهدة تم تسويتها');
    }

    const updateData: any = {};
    if (body.employee_id !== undefined) updateData.employee_id = body.employee_id;
    if (body.amount !== undefined) {
      updateData.amount = parseFloat(body.amount);
      // تحديث المبلغ المتبقي إذا لم يتم تحديده صراحة
      if (body.remaining_amount === undefined) {
        updateData.remaining_amount = parseFloat(body.amount);
      }
    }
    if (body.remaining_amount !== undefined) updateData.remaining_amount = parseFloat(body.remaining_amount);
    if (body.date !== undefined) updateData.date = body.date;
    if (body.reason !== undefined) updateData.reason = body.reason;
    if (body.description !== undefined) updateData.reason = body.description; // backwards compat
    if (body.status !== undefined) updateData.status = body.status;

    const { data: updated, error: updateErr } = await s.from('custodies')
      .update(updateData)
      .eq('id', id)
      .select('*')
      .single();

    if (updateErr) {
      console.error('Custody update error:', updateErr);
      throw updateErr;
    }

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
      .select('id, status, journal_entry_id')
      .eq('id', id)
      .eq('company_id', auth.companyId)
      .maybeSingle();

    if (!existing) return notFound();

    if ((existing as any).status === 'settled') {
      return error('لا يمكن حذف عهدة تم تسويتها');
    }

    // حذف تسويات العهدة أولاً
    await s.from('custody_settlements').delete().eq('custody_id', id);
    
    // حذف إيداعات العهدة
    try {
      await s.from('custody_deposits').delete().eq('custody_id', id);
    } catch (e) {
      // table might not exist or have no data
    }

    // حذف القيد المحاسبي المرتبط إن وجد
    if ((existing as any).journal_entry_id) {
      await s.from('journal_lines').delete().eq('journal_entry_id', (existing as any).journal_entry_id);
      await s.from('journal_entries').delete().eq('id', (existing as any).journal_entry_id);
    }

    // حذف العهدة
    await s.from('custodies').delete().eq('id', id);

    return success({ deleted: true });
  } catch (err) {
    return handleApiError(err);
  }
}

async function parseBodySafe(request: Request): Promise<any> {
  try {
    return await request.json();
  } catch {
    return {};
  }
}
