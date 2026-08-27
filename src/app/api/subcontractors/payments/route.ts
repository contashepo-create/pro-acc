import {NextRequest} from 'next/server';
import {success, error, parseBody, handleApiError, requireModulePermission} from '@/lib/api-helpers';
import {getSupabase} from '@/lib/supabase-client';

const sb = () => getSupabase();

export async function POST(req: NextRequest) {
  try {
    const auth = await requireModulePermission(req, 'subcontractors', 'create');
    const data = await parseBody(req);
    const { contract_id, certificate_id, amount: rawAmount, date, bank_safe_id, notes } = data;
    const amount = Number(rawAmount);
    if (!contract_id || typeof contract_id !== 'string' || !bank_safe_id || typeof bank_safe_id !== 'string'
      || !date || !/^\d{4}-\d{2}-\d{2}$/.test(String(date))) {
      return error('العقد والتاريخ والخزينة مطلوبة');
    }
    if (certificate_id !== undefined && certificate_id !== null && typeof certificate_id !== 'string') return error('معرّف الشهادة غير صالح');
    if (!Number.isFinite(amount) || amount <= 0 || Math.abs(amount * 100 - Math.round(amount * 100)) > 1e-8) return error('قيمة الدفعة غير صالحة');
    if (notes !== undefined && (typeof notes !== 'string' || notes.length > 2000)) return error('الملاحظات غير صالحة');

    const { data: payment, error: rpcError } = await sb().rpc('create_subcontractor_payment_atomic', {
      p_company_id: auth.companyId,
      p_contract_id: contract_id,
      p_certificate_id: certificate_id || null,
      p_amount: amount,
      p_date: date,
      p_bank_safe_id: bank_safe_id,
      p_notes: notes?.trim() || null,
      p_user_id: auth.userId,
    });
    if (rpcError) {
      const message = String(rpcError.message || '');
      if (message.includes('غير موجود') || message.includes('لا تخص العقد')) return error(message, 404);
      if (message.includes('تتجاوز') || message.includes('غير كاف') || message.includes('ملغى')) return error(message, 409);
      throw rpcError;
    }
    return success(payment, 201);
  } catch (err) {
    return handleApiError(err);
  }
}
