import { NextRequest } from 'next/server';
import { success, error, requireApiAuth, handleApiError } from '@/lib/api-helpers';
import { getSupabase } from '@/lib/supabase-client';

// @ts-ignore
const sb = () => getSupabase() as any;

export async function GET(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const auth = await requireApiAuth(req);
    const { id } = await params;
    const s = sb();

    const { data: rec, error: recError } = await s.from('bank_reconciliation')
      .select('*')
      .eq('id', id)
      .eq('company_id', auth.companyId)
      .maybeSingle();

    if (recError || !rec) return error('Not found', 404);

    const { data: items } = await s.from('bank_reconciliation_items')
      .select('*')
      .eq('reconciliation_id', id)
      .order('date');

    return success({ ...rec, items: items || [] });
  } catch (e: any) {
    return handleApiError(e);
  }
}

export async function PUT(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const auth = await requireApiAuth(req);
    const { id } = await params;
    const body = await req.json();
    const s = sb();

    const updateData: any = {};
    if (body.closingBalance !== undefined) updateData.closing_balance = body.closingBalance;
    if (body.status !== undefined) updateData.status = body.status;

    const { data: result, error: updateError } = await s.from('bank_reconciliation')
      .update(updateData)
      .eq('id', id)
      .eq('company_id', auth.companyId)
      .select('*')
      .maybeSingle();

    if (updateError || !result) return error('Not found', 404);
    return success(result);
  } catch (e: any) {
    return handleApiError(e);
  }
}

export async function DELETE(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const auth = await requireApiAuth(req);
    const { id } = await params;
    const s = sb();

    // Verify belongs to company first
    const { data: rec } = await s.from('bank_reconciliation').select('id').eq('id', id).eq('company_id', auth.companyId).maybeSingle();
    if (!rec) return error('Not found', 404);

    await s.from('bank_reconciliation_items').delete().eq('reconciliation_id', id);

    const { data: result, error: deleteError } = await s.from('bank_reconciliation')
      .delete()
      .eq('id', id)
      .eq('company_id', auth.companyId)
      .select('id')
      .maybeSingle();

    if (deleteError || !result) return error('Not found', 404);
    return success({ deleted: true });
  } catch (e: any) {
    return handleApiError(e);
  }
}
