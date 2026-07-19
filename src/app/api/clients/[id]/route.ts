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

    const { data: client } = await s.from('contacts')
      .select('*, accounts(code, name)')
      .eq('id', id)
      .eq('company_id', auth.companyId)
      .eq('type', 'client')
      .maybeSingle();

    if (!client) return notFound();

    return success({
      ...(client as any),
      account_code: (client as any).accounts?.code || null,
      account_name: (client as any).accounts?.name || null,
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

    const { data: existing } = await s.from('contacts')
      .select('id')
      .eq('id', id)
      .eq('company_id', auth.companyId)
      .maybeSingle();

    if (!existing) return notFound();

    const updateData: any = {};
    if (body.name !== undefined) updateData.name = body.name;
    if (body.phone !== undefined) updateData.phone = body.phone;
    if (body.email !== undefined) updateData.email = body.email;
    if (body.tax_number !== undefined) updateData.tax_number = body.tax_number;
    if (body.credit_limit !== undefined) updateData.credit_limit = body.credit_limit;
    if (body.address !== undefined) updateData.address = body.address;

    const { data: updated, error: updateErr } = await s.from('contacts')
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

    const { data: existing } = await s.from('contacts')
      .select('id')
      .eq('id', id)
      .eq('company_id', auth.companyId)
      .maybeSingle();

    if (!existing) return notFound();

    // Check if client has invoices
    const { data: invoices } = await s.from('invoices')
      .select('id')
      .eq('contact_id', id)
      .limit(1);

    if (invoices && invoices.length > 0) {
      return error('لا يمكن حذف العميل لأنه مرتبط بفواتير');
    }

    await s.from('contacts').delete().eq('id', id);

    return success({ deleted: true });
  } catch (err) {
    return handleApiError(err);
  }
}
