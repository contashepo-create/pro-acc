import { NextRequest } from 'next/server';
import { success, error, parseBody, requireModulePermission, handleApiError } from '@/lib/api-helpers';
import { getSupabase } from '@/lib/supabase-client';
import { addCustodyFundsSchema, custodyUuid } from '@/lib/custody-validation';
import { localDateISO } from '@/lib/fiscal-calendar';

export async function POST(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const auth = await requireModulePermission(request, 'custodies', 'create');
    const { id } = await params;
    if (!custodyUuid.safeParse(id).success) return error('معرف ملف العهدة غير صالح');
    const parsed = addCustodyFundsSchema.safeParse(await parseBody(request));
    if (!parsed.success) return error(parsed.error.issues[0]?.message || 'بيانات تعزيز العهدة غير صالحة');
    const input = parsed.data;
    const { data: updated, error: rpcError } = await getSupabase().rpc('add_custody_funds', {
      p_company_id: auth.companyId,
      p_custody_id: id,
      p_date: input.date || localDateISO(),
      p_amount: input.amount,
      p_description: input.description || 'تعزيز عهدة',
      p_bank_safe_id: input.bank_safe_id,
      p_created_by: auth.userId,
    });
    if (rpcError) throw rpcError;
    return success(updated, 201);
  } catch (cause) {
    return handleApiError(cause);
  }
}
