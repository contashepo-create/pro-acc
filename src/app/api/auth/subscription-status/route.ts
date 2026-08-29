import {NextRequest} from 'next/server';
import {success, requireApiAuth, handleApiError} from '@/lib/api-helpers';
import {getSubscriptionAccess} from '@/lib/subscription-guard';

export async function GET(request: NextRequest) {
  try {
    const { companyId } = await requireApiAuth(request, { skipModuleGuard: true });
    const access = await getSubscriptionAccess(companyId);
    return success({
      is_expired: access.isExpired,
      is_trial_expired: access.status === 'trial_expired',
      is_expiring_soon: !access.isExpired && access.daysRemaining <= 7 && access.daysRemaining >= 0,
      days_remaining: access.daysRemaining,
      plan_name: access.planName,
      plan_code: access.planCode,
      end_date: access.endDate,
      status: access.status,
      // رقم المشترك الدائم — يعرض في تاب الاشتراك بالإعدادات للتواصل مع الدعم
      subscriber_number: access.subscriberNumber,
      reason: access.reason || null,
      features: access.features,
    });
  } catch (err) {
    return handleApiError(err);
  }
}
