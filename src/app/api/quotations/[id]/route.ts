import { NextRequest } from 'next/server';
import { success, error, notFound, parseBody, requireApiAuth, handleApiError } from '@/lib/api-helpers';
import { getSupabase } from '@/lib/supabase-client';

const sb = () => getSupabase();

export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const auth = await requireApiAuth(req);
    const { id } = await params;
    const s = sb();

    const { data: quotation, error: queryErr } = await s.from('quotations')
      .select('*, contacts(name)')
      .eq('id', id)
      .eq('company_id', auth.companyId)
      .maybeSingle();

    if (queryErr) throw queryErr;
    if (!quotation) return notFound();

    const { data: items } = await s.from('quotation_items')
      .select('*')
      .eq('quotation_id', id)
      .order('id');

    const result = quotation as Record<string, any>;
    result.items = items || [];
    result.contact_name = result.contacts?.name || null;

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
    const auth = await requireApiAuth(req);
    const { id } = await params;
    const s = sb();
    const body = await parseBody(req);

    const { data: existing } = await s.from('quotations')
      .select('id, status')
      .eq('id', id)
      .eq('company_id', auth.companyId)
      .maybeSingle();

    if (!existing) return notFound();

    const updateData: any = {};
    if (body.date !== undefined) updateData.date = body.date;
    if (body.contact_id !== undefined) updateData.contact_id = body.contact_id;
    if (body.valid_until !== undefined) updateData.valid_until = body.valid_until;
    if (body.status !== undefined) updateData.status = body.status;
    if (body.notes !== undefined) updateData.notes = body.notes;
    if (body.terms !== undefined) updateData.terms = body.terms;

    if (body.items !== undefined) {
      let subtotal = 0;
      for (const item of body.items) subtotal += (item.quantity || 0) * (item.unit_price || 0);
      const rate = body.tax_rate || 0;
      const taxAmount = subtotal * rate;
      const total = subtotal + taxAmount - (body.discount_amount || 0);

      updateData.subtotal = subtotal;
      updateData.tax_amount = taxAmount;
      updateData.total = total;
      if (body.tax_rate !== undefined) updateData.tax_rate = body.tax_rate;
      if (body.discount_amount !== undefined) updateData.discount_amount = body.discount_amount;

      await s.from('quotation_items').delete().eq('quotation_id', id);
      for (const item of body.items) {
        await s.from('quotation_items').insert({
          quotation_id: id,
          description: item.description,
          quantity: item.quantity,
          unit_price: item.unit_price,
          total: item.quantity * item.unit_price,
        });
      }
    }

    const { data: updated, error: updateErr } = await s.from('quotations')
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
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const auth = await requireApiAuth(req);
    const { id } = await params;
    const s = sb();

    const { data: existing } = await s.from('quotations')
      .select('id, status')
      .eq('id', id)
      .eq('company_id', auth.companyId)
      .maybeSingle();

    if (!existing) return notFound();

    if ((existing as any).status === 'converted') {
      return error('لا يمكن حذف عرض محول إلى مشروع');
    }

    await s.from('quotation_items').delete().eq('quotation_id', id);
    await s.from('quotations').delete().eq('id', id);

    return success({ deleted: true });
  } catch (err) {
    return handleApiError(err);
  }
}
