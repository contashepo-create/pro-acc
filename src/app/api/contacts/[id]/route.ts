import { NextRequest } from 'next/server';
import { success, error, notFound, requireApiAuth, handleApiError } from '@/lib/api-helpers';
import { getSupabase } from '@/lib/supabase-client';
import { generateId } from '@/lib/utils';

// @ts-ignore
const sb = () => getSupabase() as any;

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const auth = await requireApiAuth(request);
    const { id } = await params;
    const s = sb();

    const { data: contact, error: queryError } = await s.from('contacts')
      .select('*, accounts(code, name)')
      .eq('id', id)
      .eq('company_id', auth.companyId)
      .maybeSingle();

    if (queryError || !contact) {
      return notFound();
    }

    const c: any = contact;
    let balance = 0;
    let balanceType: string | null = null;

    if (c.account_id) {
      const { data: jes } = await s.from('journal_entries')
        .select('id')
        .eq('company_id', auth.companyId);
      const jeIds = (jes || []).map((je: any) => je.id);
      if (jeIds.length > 0) {
        const { data: lines } = await s.from('journal_lines')
          .select('debit, credit')
          .eq('account_id', c.account_id)
          .in('journal_entry_id', jeIds);
        const totalDebit = (lines || []).reduce((s: number, l: any) => s + (parseFloat(l.debit) || 0), 0);
        const totalCredit = (lines || []).reduce((s: number, l: any) => s + (parseFloat(l.credit) || 0), 0);
        balance = totalDebit - totalCredit;
        balanceType = balance >= 0 ? 'debit' : 'credit';
      }
    }

    return success({
      ...c,
      account_code: c.accounts?.code || null,
      account_name: c.accounts?.name || null,
      balance: Math.abs(balance),
      balance_type: balanceType,
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
    const auth = await requireApiAuth(request);
    const { id } = await params;
    const s = sb();
    const body = await request.json();

    const { data: contactRes } = await s.from('contacts')
      .select('*')
      .eq('id', id)
      .eq('company_id', auth.companyId)
      .maybeSingle();

    if (!contactRes) {
      return notFound();
    }

    const contact: any = contactRes;

    const updateData: Record<string, any> = {};
    if (body.name !== undefined) updateData.name = body.name;
    if (body.type !== undefined) updateData.type = body.type;
    if (body.phone !== undefined) updateData.phone = body.phone;
    if (body.email !== undefined) updateData.email = body.email;
    if (body.tax_number !== undefined) updateData.tax_number = body.tax_number;
    if (body.address !== undefined) updateData.address = body.address;

    if (Object.keys(updateData).length > 0) {
      const { error: updateError } = await s.from('contacts')
        .update(updateData)
        .eq('id', id);
      if (updateError) throw updateError;
    }

    if (!contact.account_id) {
      let accountCode: string;
      let accountType: string;
      const type = body.type || contact.type;
      if (type === 'client') {
        accountCode = '1130';
        accountType = 'asset';
      } else if (type === 'supplier') {
        accountCode = '2110';
        accountType = 'liability';
      } else {
        accountCode = '2150';
        accountType = 'liability';
      }

      const newAccountId = generateId();
      const { error: accErr } = await s.from('accounts')
        .insert({
          id: newAccountId,
          company_id: auth.companyId,
          code: accountCode,
          name: body.name || contact.name,
          type: accountType,
          is_active: true,
        });
      if (accErr) throw accErr;

      const { error: linkErr } = await s.from('contacts')
        .update({ account_id: newAccountId })
        .eq('id', id);
      if (linkErr) throw linkErr;
    }

    const { data: updated, error: fetchError } = await s.from('contacts')
      .select('*, accounts(code, name)')
      .eq('id', id)
      .single();

    if (fetchError) throw fetchError;

    const u: any = updated;
    return success({
      ...u,
      account_code: u.accounts?.code || null,
      account_name: u.accounts?.name || null,
    });
  } catch (err) {
    return handleApiError(err);
  }
}

export async function DELETE(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const auth = await requireApiAuth(request);
    const { id } = await params;
    const s = sb();

    const { data: contactRes } = await s.from('contacts')
      .select('*')
      .eq('id', id)
      .eq('company_id', auth.companyId)
      .maybeSingle();

    if (!contactRes) {
      return notFound();
    }

    const contact: any = contactRes;

    const { data: invDep } = await s.from('invoices')
      .select('id')
      .eq('contact_id', id)
      .limit(1);
    if (invDep && invDep.length > 0) {
      return error('لا يمكن حذف الطرف لأنه مرتبط بفواتير');
    }

    const { data: projDep } = await s.from('projects')
      .select('id')
      .eq('client_id', id)
      .limit(1);
    if (projDep && projDep.length > 0) {
      return error('لا يمكن حذف الطرف لأنه مرتبط بمشاريع');
    }

    if (contact.account_id) {
      const { error: accErr } = await s.from('accounts')
        .update({ is_active: false })
        .eq('id', contact.account_id);
      if (accErr) throw accErr;
    }

    const { error: deleteError } = await s.from('contacts')
      .delete()
      .eq('id', id);
    if (deleteError) throw deleteError;

    return success({ deleted: true });
  } catch (err) {
    return handleApiError(err);
  }
}
