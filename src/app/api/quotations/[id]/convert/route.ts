import { NextRequest } from 'next/server';
import { success, error, parseBody, handleApiError, requireModulePermission } from '@/lib/api-helpers';
import { getSupabase } from '@/lib/supabase-client';

const sb = () => getSupabase();

/** Convert an accepted quotation to project, BOQ, invoice and journal once. */
export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const auth = await requireModulePermission(req, 'quotations', 'create');
    const { id } = await params;
    const body = await parseBody<{ name?: string; start_date?: string; end_date?: string | null }>(req);
    const name = body.name?.trim();
    if (!name || name.length > 300) return error('اسم المشروع مطلوب');
    if (!body.start_date || !/^\d{4}-\d{2}-\d{2}$/.test(body.start_date)) {
      return error('تاريخ بدء المشروع غير صالح');
    }
    if (body.end_date && !/^\d{4}-\d{2}-\d{2}$/.test(body.end_date)) {
      return error('تاريخ انتهاء المشروع غير صالح');
    }

    const { data, error: convertError } = await sb().rpc('convert_quotation_atomic', {
      p_company_id: auth.companyId,
      p_quotation_id: id,
      p_project_name: name,
      p_start_date: body.start_date,
      p_end_date: body.end_date || null,
      p_user_id: auth.userId,
    });
    if (convertError) throw convertError;
    return success(data, 201);
  } catch (err) {
    return handleApiError(err);
  }
}
