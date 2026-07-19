import { NextRequest } from 'next/server';
import { success, error, notFound, requireApiAuth, requireManagerOrAbove, handleApiError } from '@/lib/api-helpers';
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

    const { data: category } = await s.from('transaction_categories')
      .select('*')
      .eq('id', id)
      .eq('company_id', auth.companyId)
      .maybeSingle();

    if (!category) return notFound();

    return success(category);
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

    const { data: existing } = await s.from('transaction_categories')
      .select('id')
      .eq('id', id)
      .eq('company_id', auth.companyId)
      .maybeSingle();

    if (!existing) return notFound();

    const updateData: any = {};
    if (body.name !== undefined) updateData.name = body.name;
    if (body.type !== undefined) updateData.type = body.type;

    const { data: updated, error: updateErr } = await s.from('transaction_categories')
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

    const { data: existing } = await s.from('transaction_categories')
      .select('id')
      .eq('id', id)
      .eq('company_id', auth.companyId)
      .maybeSingle();

    if (!existing) return notFound();

    // Check if category is used in transactions
    const { data: transactions } = await s.from('cash_transactions')
      .select('id')
      .eq('category_id', id)
      .limit(1);

    if (transactions && transactions.length > 0) {
      return error('لا يمكن حذف الفئة لأنها مستخدمة في معاملات');
    }

    await s.from('transaction_categories').delete().eq('id', id);

    return success({ deleted: true });
  } catch (err) {
    return handleApiError(err);
  }
}
