import { NextRequest } from 'next/server';
import { success, error, parseBody, requireModulePermission, handleApiError } from '@/lib/api-helpers';
import { getSupabase } from '@/lib/supabase-client';
import { loadCustodyFile, assertFileOpen, round2 } from '@/lib/custody';

/**
 * إغلاق ملف عهدة — يتطلب confirm: true
 * المتبقي بعد المصروفات:
 *   مرتجع نقدي → مدين الصندوق / دائن 1150
 *   عجز بعد المرتجع → مدين 1160 سلفة / دائن 1150 + سجل سلفة على الراتب
 */
export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const auth = await requireModulePermission(req, 'custodies', 'approve');
    const { id } = await params;
    const data = await parseBody(req);

    if (data.confirm !== true) {
      return error('إغلاق الملف يتطلب تأكيداً صريحاً (confirm: true)');
    }

    const file = await loadCustodyFile(auth.companyId, id);
    if (!file) return error('ملف العهدة غير موجود', 404);
    assertFileOpen(file);

    const date = data.date || new Date().toISOString().split('T')[0];
    const returnedCash = round2(parseFloat(data.returned_cash) || 0);
    if (!Number.isFinite(returnedCash) || returnedCash<0) return error('المرتجع لا يكون سالباً');
    if (!/^\d{4}-\d{2}-\d{2}$/.test(String(date))) return error('التاريخ غير صالح');
    const bankSafeId = data.bank_safe_id || file.bank_safe_id || null;
    if (returnedCash>0 && !bankSafeId) return error('حدد الخزينة لاستلام المرتجع');
    const s = getSupabase();
    const { data: settled, error: rpcErr } = await s.rpc('settle_custody_file', {
      p_company_id: auth.companyId,
      p_custody_id: id,
      p_date: date,
      p_returned_cash: returnedCash,
      p_bank_safe_id: bankSafeId,
      p_description: typeof data.description === 'string' ? data.description.trim() : '',
      p_created_by: auth.userId,
    });
    if (rpcErr) throw rpcErr;
    const result = settled as Record<string,any>;
    return success({
      ...result,
      message: Number(result.shortage)>0
        ? `أُغلق الملف. عجز ${result.shortage} سلفة على راتب الموظف`
        : 'أُغلق الملف دون عجز',
    });
  } catch (err) {
    return handleApiError(err);
  }
}
