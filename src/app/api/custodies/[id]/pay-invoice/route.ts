import { NextRequest } from 'next/server';
import { success, error, parseBody, requireModulePermission, handleApiError } from '@/lib/api-helpers';
import { getSupabase } from '@/lib/supabase-client';
import { loadCustodyFile, assertFileOpen } from '@/lib/custody';
import { custodyUuid, payCustodyInvoiceSchema } from '@/lib/custody-validation';
import { localDateISO } from '@/lib/fiscal-calendar';

/** يسدد ذمة مورد قائمة (2110) من رصيد العهدة (1150) دون إنشاء فاتورة جديدة. */
export async function POST(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const auth = await requireModulePermission(request, 'custodies', 'update');
    const { id } = await params;
    if (!custodyUuid.safeParse(id).success) return error('معرف ملف العهدة غير صالح');
    const parsed = payCustodyInvoiceSchema.safeParse(await parseBody(request));
    if (!parsed.success) return error(parsed.error.issues[0]?.message || 'بيانات سداد المورد غير صالحة');
    const input = parsed.data;

    const file = await loadCustodyFile(auth.companyId, id);
    if (!file) return error('ملف العهدة غير موجود', 404);
    assertFileOpen(file);

    const { data, error: rpcError } = await getSupabase().rpc('pay_purchase_invoice_from_custody', {
      p_company_id: auth.companyId,
      p_custody_id: id,
      p_purchase_invoice_id: input.purchase_invoice_id,
      p_amount: input.amount ?? null,
      p_date: input.date || localDateISO(),
      p_created_by: auth.userId,
    });
    const message = String(rpcError?.message || '');
    if (message.includes('غير موجود')) return error(message, 404);
    if (message.includes('غير صالح') || message.includes('أكبر') || message.includes('يتجاوز') || message.includes('مسبقاً') || message.includes('مغلق')) {
      return error(message, 409);
    }
    if (rpcError) throw rpcError;
    return success(data, 201);
  } catch (cause) {
    return handleApiError(cause);
  }
}
