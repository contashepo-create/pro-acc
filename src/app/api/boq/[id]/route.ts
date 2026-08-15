import { NextRequest } from 'next/server';
import { success, error, notFound, parseBody, requireApiAuth, handleApiError, requireModulePermission } from '@/lib/api-helpers';
import { getSupabase } from '@/lib/supabase-client';

const sb = () => getSupabase();

export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const auth = await requireModulePermission(req, 'boq', 'read');
    const { id } = await params;
    const s = sb();

    const { data: item, error: queryErr } = await s.from('boq_items')
      .select('*, projects(name)')
      .eq('id', id)
      .eq('company_id', auth.companyId)
      .maybeSingle();

    if (queryErr) throw queryErr;
    if (!item) return notFound();

    const result = item as Record<string, any>;
    result.project_name = result.projects?.name || null;

    return success(result);
  } catch (err) {
    return handleApiError(err);
  }
}

export async function PUT(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const auth = await requireModulePermission(req, 'boq', 'update');
    const { id } = await params;
    const s = sb();
    const body = await parseBody(req);

    const { data: existing } = await s.from('boq_items')
      .select('id, project_id, quantity, unit_price')
      .eq('id', id)
      .eq('company_id', auth.companyId)
      .maybeSingle();

    if (!existing) return notFound();
    const { data: project } = await s.from('projects')
      .select('status').eq('id', (existing as any).project_id).eq('company_id', auth.companyId).maybeSingle();
    if (!project || ['completed', 'cancelled'].includes((project as any).status)) return error('لا يمكن تعديل كميات مشروع مغلق');

    const updateData: any = {};
    if (body.item_code !== undefined || body.code !== undefined) {
      const code = body.item_code ?? body.code;
      if (typeof code !== 'string' || !code.trim() || code.length > 80) return error('كود البند غير صالح');
      updateData.item_code = code.trim();
    }
    if (body.description !== undefined) {
      if (typeof body.description !== 'string' || !body.description.trim() || body.description.length > 1000) return error('وصف البند غير صالح');
      updateData.description = body.description.trim();
    }
    if (body.unit !== undefined) {
      if (typeof body.unit !== 'string' || !body.unit.trim() || body.unit.length > 40) return error('وحدة القياس غير صالحة');
      updateData.unit = body.unit.trim();
    }
    const quantity = body.quantity !== undefined ? Number(body.quantity) : Number((existing as any).quantity);
    const unitPrice = body.unit_price !== undefined ? Number(body.unit_price) : Number((existing as any).unit_price);
    if (!Number.isFinite(quantity) || quantity <= 0 || !Number.isFinite(unitPrice) || unitPrice < 0) return error('الكمية أو السعر غير صالح');
    if (body.quantity !== undefined) updateData.quantity = quantity;
    if (body.unit_price !== undefined) updateData.unit_price = unitPrice;
    if (body.quantity !== undefined || body.unit_price !== undefined) updateData.total = Math.round(quantity * unitPrice * 100) / 100;
    if (Object.keys(updateData).length === 0) return error('لا توجد تغييرات');

    const { data: updated, error: updateErr } = await s.from('boq_items')
      .update(updateData)
      .eq('id', id).eq('company_id', auth.companyId)
      .select('*')
      .single();

    if (updateErr) throw updateErr;

    return success(updated);
  } catch (err) {
    return handleApiError(err);
  }
}

export async function DELETE(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const auth = await requireModulePermission(req, 'boq', 'delete');
    const { id } = await params;
    const s = sb();

    const { data: existing } = await s.from('boq_items')
      .select('id')
      .eq('id', id)
      .eq('company_id', auth.companyId)
      .maybeSingle();

    if (!existing) return notFound();

    await s.from('boq_items').delete().eq('id', id).eq('company_id', auth.companyId);

    return success({ deleted: true });
  } catch (err) {
    return handleApiError(err);
  }
}
