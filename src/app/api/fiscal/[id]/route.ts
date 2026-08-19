import { NextRequest } from 'next/server';
import { success, error, notFound, requireApiAuth, requireModulePermission, handleApiError } from '@/lib/api-helpers';
import { getSupabase } from '@/lib/supabase-client';

const sb = () => getSupabase();

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const auth = await requireModulePermission(request, 'fiscal', 'read');
    const { id } = await params;
    const { data, error: qErr } = await sb().from('fiscal_years')
      .select('*').eq('id', id).eq('company_id', auth.companyId).maybeSingle();
    if (qErr) throw qErr;
    if (!data) return notFound();
    return success(data);
  } catch (err) {
    return handleApiError(err);
  }
}

export async function PUT(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const auth = await requireModulePermission(request, 'fiscal', 'update');
    const { id } = await params;
    const s = sb();
    const body = await request.json();

    const { data: existing } = await s.from('fiscal_years')
      .select('*').eq('id', id).eq('company_id', auth.companyId).maybeSingle();
    if (!existing) return notFound();
    if ((existing as any).status === 'closed') return error('لا يمكن تعديل سنة مالية مقفلة');

    const updateData: any = {};
    if (body.name !== undefined) updateData.name = body.name;
    if (body.start_date !== undefined) updateData.start_date = body.start_date;
    if (body.end_date !== undefined) updateData.end_date = body.end_date;

    const { data: updated, error: updErr } = await s.from('fiscal_years')
      .update(updateData).eq('id', id).eq('company_id', auth.companyId).select('*').single();
    if (updErr) {
      const message = String((updErr as { message?: string }).message || '');
      if (/تتداخل/.test(message)) return error(message, 409);
      throw updErr;
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
    const auth = await requireModulePermission(request, 'fiscal', 'delete');
    const { id } = await params;
    const s = sb();

    const { data: existing } = await s.from('fiscal_years')
      .select('id, status').eq('id', id).eq('company_id', auth.companyId).maybeSingle();
    if (!existing) return notFound();
    if ((existing as any).status === 'closed') return error('لا يمكن حذف سنة مالية مقفلة');
    if ((existing as any).status === 'open') return error('لا يمكن حذف سنة مالية مفتوحة — يجب إقفالها أولاً', 409);

    const { error: delErr } = await s.from('fiscal_years').delete().eq('id', id).eq('company_id', auth.companyId);
    if (delErr) throw delErr;
    return success({ deleted: true });
  } catch (err) {
    return handleApiError(err);
  }
}
