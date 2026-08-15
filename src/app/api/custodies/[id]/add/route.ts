import { NextRequest } from 'next/server';
import { success, error, parseBody, requireModulePermission, handleApiError } from '@/lib/api-helpers';
import { getSupabase } from '@/lib/supabase-client';
import { round2 } from '@/lib/custody';

export async function POST(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const auth = await requireModulePermission(request, 'custodies', 'create');
    const { id } = await params;
    const body = await parseBody(request);
    const amount = round2(parseFloat(body.amount));
    const bank_safe_id = body.bank_safe_id;
    const date = body.date || new Date().toISOString().split('T')[0];
    const description = body.description || 'تعزيز عهدة';

    if (!amount || amount <= 0) return error('مبلغ التعزيز يجب أن يكون موجباً');
    if (!bank_safe_id) return error('مصدر الصرف مطلوب');

    if (!/^\d{4}-\d{2}-\d{2}$/.test(String(date))) return error('التاريخ غير صالح');
    if (typeof description !== 'string' || description.length > 2000) return error('البيان غير صالح');
    const s = getSupabase();
    const { data: updated, error: rpcErr } = await s.rpc('add_custody_funds', {
      p_company_id: auth.companyId,
      p_custody_id: id,
      p_date: date,
      p_amount: amount,
      p_description: description.trim(),
      p_bank_safe_id: bank_safe_id,
      p_created_by: auth.userId,
    });
    if (rpcErr) throw rpcErr;
    return success(updated, 201);
  } catch (err) {
    return handleApiError(err);
  }
}
