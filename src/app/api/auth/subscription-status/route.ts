import {NextRequest} from 'next/server';
import {success, requireApiAuth, handleApiError} from '@/lib/api-helpers';
import {getSubscriptionAccess} from '@/lib/subscription-guard';
import {getSupabase} from '@/lib/supabase-client';

export async function GET(request: NextRequest) {
  try {
    const { companyId } = await requireApiAuth(request, { skipModuleGuard: true });
    const access = await getSubscriptionAccess(companyId);
    const s = getSupabase();
    const { data: sub } = await s.from('subscriptions')
      .select('subscriber_number, id')
      .eq('company_id', companyId)
      .maybeSingle();
    return success({
      is_expired: access.isExpired,
      is_trial_expired: access.status === 'trial_expired',
      is_expiring_soon: !access.isExpired && access.daysRemaining <= 7 && access.daysRemaining >= 0,
      days_remaining: access.daysRemaining,
      plan_name: access.planName,
      plan_code: access.planCode,
      end_date: access.endDate,
      status: access.status,
      reason: access.reason || null,
      features: access.features,
      subscriber_number: (sub as Record<string, unknown> | null)?.subscriber_number || null,
      subscription_id: (sub as Record<string, unknown> | null)?.id || null,
    });
  } catch (err) {
    return handleApiError(err);
  }
}
