import { NextRequest } from 'next/server';
import { success, error, notFound, requireModulePermission, requireManagerOrAbove, handleApiError } from '@/lib/api-helpers';
import { getSupabase } from '@/lib/supabase-client';
import { pickContactFields, writeContact } from '@/lib/contact-fields';

const sb = () => getSupabase();

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const auth = await requireModulePermission(request, 'clients', 'read');
    const { id } = await params;
    const s = sb();

    const { data: client } = await s.from('contacts')
      .select('*, accounts(code, name)')
      .eq('id', id)
      .eq('company_id', auth.companyId)
      .in('type', ['client', 'both'])
      .maybeSingle();

    if (!client) return notFound();

    const balance = await getContactBalance(auth.companyId, id);

    return success({
      ...(client as any),
      account_code: (client as any).accounts?.code || null,
      account_name: (client as any).accounts?.name || null,
      balance,
      balance_type: balance >= 0 ? 'debit' : 'credit',
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
    const picked = pickContactFields(body);
    if (picked.error) return error(picked.error);
    if (!picked.data || Object.keys(picked.data).length === 0) {
      return error('لا توجد بيانات للتحديث');
    }

    const { data: existing } = await s.from('contacts')
      .select('id')
      .eq('id', id)
      .eq('company_id', auth.companyId)
      .maybeSingle();

    if (!existing) return notFound();

    const { data: updated, error: updateErr } = await writeContact(s, 'update', picked.data, {
      companyId: auth.companyId,
      id,
    });
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

    const { data: invoices } = await s.from('invoices')
      .select('id').eq('contact_id', id).eq('company_id', auth.companyId).limit(1);
    if (invoices && invoices.length > 0) {
      return error('لا يمكن حذف العميل لأنه مرتبط بفواتير');
    }

    const { data: rcptDep } = await s.from('voucher_receipts')
      .select('id').eq('contact_id', id).eq('company_id', auth.companyId).limit(1);
    if (rcptDep && rcptDep.length > 0) {
      return error('لا يمكن حذف العميل لأنه مرتبط بسندات قبض');
    }

    const balance = await getContactBalance(auth.companyId, id);
    if (Math.abs(balance) > 0.01) {
      return error('لا يمكن حذف عميل له رصيد — صفِّ الحساب أولاً');
    }

    await s.from('contacts').delete().eq('id', id).eq('company_id', auth.companyId);

    return success({ deleted: true });
  } catch (err) {
    return handleApiError(err);
  }
}
