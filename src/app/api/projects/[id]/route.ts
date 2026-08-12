import { NextRequest } from 'next/server';
import { success, error, notFound, requireApiAuth, requireModulePermission, requireManagerOrAbove, handleApiError } from '@/lib/api-helpers';
import { getSupabase } from '@/lib/supabase-client';

const sb = () => getSupabase();

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const auth = await requireModulePermission(request, 'projects', 'read');
    const { id } = await params;
    const s = sb();

    const { data: project } = await s.from('projects')
      .select('*, contacts(name)')
      .eq('id', id)
      .eq('company_id', auth.companyId)
      .maybeSingle();

    if (!project) return notFound();

    const { data: boq } = await s.from('boq_items')
      .select('*').eq('project_id', id).order('id');

    const p = project as any;
    return success({
      ...p,
      client_id: p.client_id || p.contact_id || '',
      client_name: p.contacts?.name || null,
      boq_items: boq || [],
    });
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

    const { data: existing } = await s.from('projects')
      .select('id')
      .eq('id', id)
      .eq('company_id', auth.companyId)
      .maybeSingle();

    if (!existing) return notFound();

    const updateData: any = {};
    if (body.name !== undefined) updateData.name = body.name;
    if (body.client_id !== undefined) updateData.client_id = body.client_id;
    if (body.start_date !== undefined) updateData.start_date = body.start_date;
    if (body.end_date !== undefined) updateData.end_date = body.end_date;
    if (body.budget !== undefined) updateData.budget = body.budget;
    if (body.status !== undefined) updateData.status = body.status;

    const { data: updated, error: updateErr } = await s.from('projects')
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

    const { data: existing } = await s.from('projects')
      .select('id')
      .eq('id', id)
      .eq('company_id', auth.companyId)
      .maybeSingle();

    if (!existing) return notFound();

    // Check if project has invoices
    const { data: invoices } = await s.from('invoices')
      .select('id')
      .eq('project_id', id)
      .eq('company_id', auth.companyId)
      .limit(1);

    if (invoices && invoices.length > 0) {
      return error('لا يمكن حذف المشروع لأنه مرتبط بفواتير');
    }

    // قيود مرتبطة بالمشروع مباشرة — لا حذف ما دامت له آثار مالية
    const { data: linkedJe } = await s.from('journal_entries')
      .select('id').eq('project_id', id).eq('company_id', auth.companyId).limit(1);
    if (linkedJe && linkedJe.length > 0) {
      return error('لا يمكن حذف المشروع لأنه مرتبط بقيود محاسبية — ألغِه بدلاً من ذلك');
    }

    // بنود BOQ والمصروفات التابعة
    await s.from('boq_items').delete().eq('project_id', id).eq('company_id', auth.companyId);

    await s.from('projects').delete().eq('id', id).eq('company_id', auth.companyId);

    return success({ deleted: true });
  } catch (err) {
    return handleApiError(err);
  }
}
