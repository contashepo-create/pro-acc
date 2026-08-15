import { NextRequest } from 'next/server';
import { success, error, notFound, requireModulePermission, handleApiError } from '@/lib/api-helpers';
import { getSupabase } from '@/lib/supabase-client';

const sb = () => getSupabase();

/** Reopen a fiscal year by reversing—not deleting—its closing entries. */
export async function POST(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const auth = await requireModulePermission(request, 'fiscal', 'approve');
    const { id } = await params;
    const { data: result, error: rpcError } = await sb().rpc('reopen_fiscal_year_atomic', {
      p_company_id: auth.companyId,
      p_fiscal_year_id: id,
      p_user_id: auth.userId,
    });
    if (rpcError) {
      const message = String(rpcError.message || '');
      if (message.includes('السنة المالية غير موجودة')) return notFound();
      if (message.includes('غير مقفلة') || message.includes('السنوات الأحدث')) return error(message, 409);
      if (message.includes('closed fiscal year')) return error('لا يوجد تاريخ مفتوح لترحيل قيد إعادة الفتح', 409);
      throw rpcError;
    }
    return success(result);
  } catch (err) {
    return handleApiError(err);
  }
}
