import { NextRequest } from 'next/server';
import { success, error, parseBody, requireModulePermission, requireManagerOrAbove, handleApiError } from '@/lib/api-helpers';
import { getSupabase } from '@/lib/supabase-client';

import type { Row } from '@/lib/types';

const sb = () => getSupabase();

export async function GET(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const auth = await requireModulePermission(req, 'salary_sheets', 'read');
    const { id } = await params;
    const s = sb();

    const { data: sheet, error: sheetError } = await s.from('salary_sheets')
      .select('*')
      .eq('id', id)
      .eq('company_id', auth.companyId)
      .maybeSingle();

    if (sheetError || !sheet) return error('كشف الرواتب غير موجود', 404);

    const { data: items, error: itemsErr } = await s.from('salary_items')
      .select('*, employees(name)')
      .eq('sheet_id', id)
      .eq('company_id', auth.companyId);
    if (itemsErr) throw itemsErr;

    const itemsWithNames = (items || []).map((si: Row) => ({
      ...si,
      employee_name: si.employees ? String((si.employees as Row).name) || '' : '',
    }));

    return success({ ...sheet, items: itemsWithNames });
  } catch (e) {
    return handleApiError(e);
  }
}

export async function PUT(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const auth = await requireModulePermission(req, 'salary_sheets', 'update');
    const { id } = await params;
    const body = await parseBody(req);
    const s = sb();

    const { data: existing } = await s.from('salary_sheets').select('id, status')
      .eq('id', id).eq('company_id', auth.companyId).maybeSingle();
    if (!existing) return error('كشف الرواتب غير موجود', 404);
    if ((existing as Row).status !== 'draft') return error('لا يمكن تعديل كشف رواتب بعد دخوله دورة الموافقة', 409);
    if (body.status !== undefined) return error('تغيير حالة الكشف يتم عبر مسار الموافقات فقط', 409);
    const updateData: Row = {};
    if (body.name !== undefined) {
      if (typeof body.name !== 'string' || !body.name.trim() || body.name.length > 200) return error('اسم الكشف غير صالح');
      updateData.name = body.name.trim();
    }
    if (!Object.keys(updateData).length) return error('لا توجد حقول قابلة للتعديل');

    const { data: result, error: updateError } = await s.from('salary_sheets')
      .update(updateData)
      .eq('id', id)
      .eq('company_id', auth.companyId)
      .eq('status','draft')
      .select('*')
      .maybeSingle();

    if (updateError || !result) return error('كشف الرواتب غير موجود', 404);
    return success(result);
  } catch (e) {
    return handleApiError(e);
  }
}

export async function DELETE(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const auth = await requireManagerOrAbove(req);
    const { id } = await params;
    const s = sb();

    const { data: deleted, error: rpcErr } = await s.rpc('delete_draft_salary_sheet', {
      p_company_id: auth.companyId,
      p_sheet_id: id,
    });
    if (rpcErr) throw rpcErr;
    return success({ deleted: deleted===true });
  } catch (e) {
    return handleApiError(e);
  }
}
