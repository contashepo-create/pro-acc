import { NextRequest } from 'next/server';
import { success, error, notFound, requireApiAuth, requireModulePermission, handleApiError } from '@/lib/api-helpers';
import { getSupabase } from '@/lib/supabase-client';

const sb = () => getSupabase();

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const auth = await requireApiAuth(request);
    const { id } = await params;
    const { data, error: qErr } = await sb().from('fixed_assets')
      .select('*').eq('id', id).eq('company_id', auth.companyId).maybeSingle();
    if (qErr) throw qErr;
    if (!data) return notFound();
    const a = data as any;
    return success({
      ...a,
      net_book_value: (a.purchase_cost || 0) - (a.accumulated_depreciation || 0),
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
    const auth = await requireModulePermission(request, 'fixed-assets', 'update');
    const { id } = await params;
    const s = sb();
    const body = await request.json();

    const { data: existing } = await s.from('fixed_assets')
      .select('id').eq('id', id).eq('company_id', auth.companyId).maybeSingle();
    if (!existing) return notFound();

    const updateData: any = {};
    for (const k of ['name', 'code', 'category', 'purchase_date', 'purchase_cost', 'useful_life_years', 'depreciation_rate', 'depreciation_method', 'location', 'notes']) {
      if (body[k] !== undefined) updateData[k] = body[k];
    }

    const { data: updated, error: updErr } = await s.from('fixed_assets')
      .update(updateData).eq('id', id).eq('company_id', auth.companyId).select('*').single();
    if (updErr) throw updErr;
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
    const auth = await requireModulePermission(request, 'fixed-assets', 'delete');
    const { id } = await params;
    const s = sb();
    const { data: existing } = await s.from('fixed_assets')
      .select('id').eq('id', id).eq('company_id', auth.companyId).maybeSingle();
    if (!existing) return notFound();
    const { error: delErr } = await s.from('fixed_assets').delete().eq('id', id).eq('company_id', auth.companyId);
    if (delErr) throw delErr;
    return success({ deleted: true });
  } catch (err) {
    return handleApiError(err);
  }
}
