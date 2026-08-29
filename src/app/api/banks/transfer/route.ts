import { NextRequest } from 'next/server';
import { z } from 'zod';
import { success, error, parseBody, requireModulePermission, handleApiError } from '@/lib/api-helpers';
import { getSupabase } from '@/lib/supabase-client';
import { isValidDate } from '@/lib/utils';

const transferSchema = z.object({
  from_id: z.string().uuid('الخزينة المصدر غير موجودة'),
  to_id: z.string().uuid('الخزينة الوجهة غير موجودة'),
  amount: z.number().finite().positive('المبلغ يجب أن يكون أكبر من صفر')
    .refine((value) => Math.abs(value * 100 - Math.round(value * 100)) < 1e-8, 'المبلغ يجب ألا يتجاوز منزلتين'),
  date: z.string().refine(isValidDate, 'تاريخ التحويل غير صالح'),
  reason: z.string().trim().min(1, 'سبب التحويل مطلوب').max(500),
}).strict();

export async function POST(request: NextRequest) {
  try {
    const auth = await requireModulePermission(request, 'banks', 'create');
    const parsed = transferSchema.safeParse(await parseBody(request));
    if (!parsed.success) return error(parsed.error.issues[0].message);
    const value = parsed.data;
    const { data, error: transferError } = await getSupabase().rpc('transfer_between_safes_atomic', {
      p_company_id: auth.companyId,
      p_from_id: value.from_id,
      p_to_id: value.to_id,
      p_amount: value.amount,
      p_date: value.date,
      p_reason: value.reason,
      p_user_id: auth.userId,
    });
    if (transferError) throw transferError;
    return success(data, 201);
  } catch (err) {
    return handleApiError(err);
  }
}
