import { NextRequest } from 'next/server';
import { error, requireAdmin, handleApiError } from '@/lib/api-helpers';

/**
 * Legacy subscription mutation endpoint.
 *
 * It previously replaced the current subscription before payment existed and
 * then created a payment row in a second statement. A failed second write
 * could strand a paid tenant on a pending plan. New purchases must use the
 * signed upgrade-request flow (or a one-time activation code), whose review
 * RPC grants the entitlement atomically with the payment decision.
 */
export async function POST(request: NextRequest) {
  try {
    await requireAdmin(request);
    return error(
      'تم إيقاف مسار الاشتراك القديم. استخدم طلب الترقية الموثق أو كود تفعيل صالح.',
      410,
    );
  } catch (err) {
    return handleApiError(err);
  }
}
