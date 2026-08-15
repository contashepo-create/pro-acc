import { NextRequest } from 'next/server';
import { success, error, notFound, requireModulePermission, requireManagerOrAbove, handleApiError } from '@/lib/api-helpers';
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
      .select('*').eq('project_id', id).eq('company_id', auth.companyId).order('id');

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

    const payload: Record<string, unknown> = {};
    for (const key of ['name','client_id','contract_value','start_date','end_date','budget','status','description','location']) {
      if (body[key] !== undefined) payload[key] = body[key];
    }
    const items = Array.isArray(body.items) ? body.items
      .filter((item: any) => item && String(item.description || '').trim())
      .map((item: any) => ({
        description: String(item.description).trim(),
        unit: typeof item.unit === 'string' ? item.unit.trim() : 'واحدة',
        quantity: Number(item.quantity),
        unit_price: Number(item.unit_price),
      })) : null;
    if (items?.some((item: any) => !Number.isFinite(item.quantity) || item.quantity <= 0
      || !Number.isFinite(item.unit_price) || item.unit_price < 0)) {
      return error('أحد بنود جدول الكميات غير صالح');
    }
    const { data: updated, error: updateError } = await s.rpc('update_project_atomic', {
      p_company_id: auth.companyId,
      p_project_id: id,
      p_payload: payload,
      p_items: items,
      p_user_id: auth.userId,
    });
    if (updateError) throw updateError;
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

    // Keep the project as an auditable cancelled record. The RPC refuses
    // cancellation while any tenant-owned financial effect remains.
    const { data: cancelled, error: cancelError } = await s.rpc('cancel_empty_project_atomic', {
      p_company_id: auth.companyId,
      p_project_id: id,
      p_user_id: auth.userId,
    });
    if (cancelError) throw cancelError;
    return success(cancelled);
  } catch (err) {
    return handleApiError(err);
  }
}
