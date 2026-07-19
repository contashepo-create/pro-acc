import { NextRequest } from 'next/server';
import { success, error, notFound, requireApiAuth, requireModulePermission, requireManagerOrAbove, handleApiError } from '@/lib/api-helpers';
import type { } from '@/lib/api-helpers';
import { getSupabase } from '@/lib/supabase-client';
import { generateId } from '@/lib/utils';

const sb = () => getSupabase();

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const auth = await requireApiAuth(request);
    const { id } = await params;
    const s = sb();

    const { data, error: queryError } = await s.from('cash_transactions')
      .select('*, banks_safes(name), accounts(name), contacts(name), journal_entries(number)')
      .eq('id', id)
      .eq('company_id', auth.companyId)
      .maybeSingle();

    if (queryError || !data) {
      return notFound();
    }

    const ct = data as Record<string, any>;
    return success({
      ...ct,
      bank_safe_name: ct.banks_safes?.name || null,
      account_name: ct.accounts?.name || null,
      contact_name: ct.contacts?.name || null,
      journal_entry_number: ct.journal_entries?.number || null,
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
    const auth = await requireModulePermission(request, 'cash', 'update');
    const { id } = await params;
    const s = sb();
    const body = await request.json();

    const { data: txRes } = await s.from('cash_transactions')
      .select('*')
      .eq('id', id)
      .eq('company_id', auth.companyId)
      .maybeSingle();

    if (!txRes) {
      return notFound();
    }

    const existing = txRes as Record<string, any>;

    const updateData: Record<string, any> = {};
    if (body.date !== undefined) updateData.date = body.date;
    if (body.type !== undefined) updateData.type = body.type;
    if (body.amount !== undefined) updateData.amount = body.amount;
    if (body.account_id !== undefined) updateData.account_id = body.account_id;
    if (body.bank_safe_id !== undefined) updateData.bank_safe_id = body.bank_safe_id;
    if (body.contact_id !== undefined) updateData.contact_id = body.contact_id;
    if (body.project_id !== undefined) updateData.project_id = body.project_id;
    if (body.category_id !== undefined) updateData.category_id = body.category_id;
    if (body.reason !== undefined) updateData.reason = body.reason;

    if (Object.keys(updateData).length > 0) {
      const { error: updateError } = await s.from('cash_transactions')
        .update(updateData)
        .eq('id', id);
      if (updateError) throw updateError;
    }

    const auditId = generateId();
    await s.from('audit_log').insert({
      id: auditId,
      company_id: auth.companyId,
      user_id: auth.userId,
      action: 'update',
      entity_type: 'cash_transaction',
      entity_id: id,
      old_values: JSON.stringify(existing),
      new_values: JSON.stringify(body),
    });

    const { data: updated, error: fetchError } = await s.from('cash_transactions')
      .select('*, journal_entries(number)')
      .eq('id', id)
      .single();

    if (fetchError) throw fetchError;

    const result = updated as Record<string, any>;
    return success({
      ...result,
      journal_entry_number: result.journal_entries?.number || null,
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
    const auth = await requireManagerOrAbove(request);
    const { id } = await params;
    const s = sb();

    const { data: txRes } = await s.from('cash_transactions')
      .select('*')
      .eq('id', id)
      .eq('company_id', auth.companyId)
      .maybeSingle();

    if (!txRes) {
      return notFound();
    }

    const tx = txRes as Record<string, any>;

    if (tx.journal_entry_id) {
      const { error: lErr } = await s.from('journal_lines')
        .delete()
        .eq('journal_entry_id', tx.journal_entry_id);
      if (lErr) throw lErr;

      const { error: jeErr } = await s.from('journal_entries')
        .delete()
        .eq('id', tx.journal_entry_id);
      if (jeErr) throw jeErr;
    }

    const auditId = generateId();
    await s.from('audit_log').insert({
      id: auditId,
      company_id: auth.companyId,
      user_id: auth.userId,
      action: 'delete',
      entity_type: 'cash_transaction',
      entity_id: id,
      old_values: JSON.stringify(tx),
    });

    const { error: deleteError } = await s.from('cash_transactions')
      .delete()
      .eq('id', id);
    if (deleteError) throw deleteError;

    return success({ deleted: true });
  } catch (err) {
    return handleApiError(err);
  }
}
