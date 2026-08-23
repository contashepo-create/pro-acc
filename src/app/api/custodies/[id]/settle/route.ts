import { NextRequest } from 'next/server';
import { success, error, parseBody, requireModulePermission, handleApiError } from '@/lib/api-helpers';
import { getSupabase } from '@/lib/supabase-client';
import { loadCustodyFile, assertFileOpen } from '@/lib/custody';
import { custodyUuid, settleCustodySchema } from '@/lib/custody-validation';

import type { Row } from '@/lib/types';

/** Confirmed closure: returned cash goes back to its safe and any remaining
 * shortage becomes an employee advance, atomically with the closing entry. */
export async function POST(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const auth = await requireModulePermission(request, 'custodies', 'approve');
    const { id } = await params;
    if (!custodyUuid.safeParse(id).success) return error('معرف ملف العهدة غير صالح');
    const parsed = settleCustodySchema.safeParse(await parseBody(request));
    if (!parsed.success) return error(parsed.error.issues[0]?.message || 'بيانات إغلاق العهدة غير صالحة');
    const input = parsed.data;

    const file = await loadCustodyFile(auth.companyId, id);
    if (!file) return error('ملف العهدة غير موجود', 404);
    assertFileOpen(file);
    const returnedCash = input.returned_cash || 0;
    const bankSafeId = input.bank_safe_id || file.bank_safe_id || null;
    if (returnedCash > 0 && !bankSafeId) return error('حدد الخزينة لاستلام المرتجع');

    const { data: settled, error: rpcError } = await getSupabase().rpc('settle_custody_file', {
      p_company_id: auth.companyId,
      p_custody_id: id,
      p_date: input.date || new Date().toISOString().slice(0, 10),
      p_returned_cash: returnedCash,
      p_bank_safe_id: bankSafeId,
      p_description: input.description || '',
      p_created_by: auth.userId,
    });
    if (rpcError) throw rpcError;
    const result = settled as Row;
    return success({
      ...result,
      message: Number(result.shortage) > 0
        ? `أُغلق الملف. عجز ${result.shortage} سلفة على راتب الموظف`
        : 'أُغلق الملف دون عجز',
    });
  } catch (cause) {
    return handleApiError(cause);
  }
}
