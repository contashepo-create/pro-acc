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

    const updateData: any = { updated_at: new Date().toISOString() };
    if (typeof body.name === 'string' && body.name.trim()) updateData.name = body.name.trim();
    if (body.start_date !== undefined) updateData.start_date = body.start_date;
    if (body.end_date !== undefined) updateData.end_date = body.end_date;
    if (body.budget !== undefined) updateData.budget = body.budget;
    if (body.status !== undefined) updateData.status = body.status;
    // كانت تُهمل رغم إرسال النموذج لها:
    if (body.contract_value !== undefined) updateData.contract_value = Number(body.contract_value) || 0;
    if (body.description !== undefined) updateData.description = body.description || null;
    if (body.location !== undefined) updateData.location = body.location || null;

    // العميل الجديد (إن تغيّر) يجب أن ينتمي للشركة — منع الربط المتقاطع
    if (body.client_id !== undefined && body.client_id) {
      const { data: client } = await s.from('contacts')
        .select('id').eq('id', body.client_id).eq('company_id', auth.companyId).maybeSingle();
      if (!client) return error('العميل المحدد غير موجود', 404);
      updateData.client_id = body.client_id;
    } else if (body.client_id === null || body.client_id === '') {
      updateData.client_id = null;
    }

    const { data: updated, error: updateErr } = await s.from('projects')
      .update(updateData)
      .eq('id', id)
      .eq('company_id', auth.companyId)
      .select('*')
      .single();

    if (updateErr) throw updateErr;

    // تحديث بنود BOQ (استبدال كامل) عند إرسالها من نموذج التعديل
    if (Array.isArray(body.items)) {
      const cleanItems = body.items.filter((it: any) => it && String(it.description || '').trim() !== '');
      await s.from('boq_items').delete().eq('project_id', id).eq('company_id', auth.companyId);
      for (const item of cleanItems) {
        const itemTotal = Number(item.total) || (Number(item.quantity) * Number(item.unit_price)) || 0;
        const { error: boqErr } = await s.from('boq_items').insert({
          company_id: auth.companyId,
          project_id: id,
          description: String(item.description).trim(),
          unit: item.unit || 'واحدة',
          quantity: Number(item.quantity) || 1,
          unit_price: Number(item.unit_price) || 0,
          total: itemTotal,
        });
        if (boqErr) throw boqErr;
      }
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
