import { NextRequest } from 'next/server';
import { success, error, parseBody, requireApiAuth, handleApiError } from '@/lib/api-helpers';
import { getSupabase } from '@/lib/supabase-client';

const sb = () => getSupabase();

export async function GET(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const auth = await requireApiAuth(req);
    const { id } = await params;
    const s = sb();

    const { data: sheet, error: sheetError } = await s.from('salary_sheets')
      .select('*')
      .eq('id', id)
      .eq('company_id', auth.companyId)
      .maybeSingle();

    if (sheetError || !sheet) return error('Not found', 404);

    const { data: items } = await s.from('salary_items')
      .select('*, employees(name)')
      .eq('sheet_id', id);

    const itemsWithNames = (items || []).map((si: any) => ({
      ...si,
      employee_name: si.employees?.name || '',
    }));

    return success({ ...sheet, items: itemsWithNames });
  } catch (e: any) {
    return handleApiError(e);
  }
}

export async function PUT(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const auth = await requireApiAuth(req);
    const { id } = await params;
    const body = await parseBody(req);
    const s = sb();

    const updateData: any = {};
    if (body.name !== undefined) updateData.name = body.name;
    if (body.status !== undefined) updateData.status = body.status;

    const { data: result, error: updateError } = await s.from('salary_sheets')
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

    const { data: sheet } = await s.from('salary_sheets').select('id').eq('id', id).eq('company_id', auth.companyId).maybeSingle();
    if (!sheet) return error('Not found', 404);

    await s.from('salary_items').delete().eq('sheet_id', id);

    const { data: result, error: deleteError } = await s.from('salary_sheets')
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
