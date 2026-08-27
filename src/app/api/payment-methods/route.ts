import { NextRequest } from 'next/server';
import { success, handleApiError } from '@/lib/api-helpers';
import { getSupabase } from '@/lib/supabase-client';

const sb = () => getSupabase();

/**
 * GET /api/payment-methods
 * Tenant-facing list of ACTIVE payment methods (for upgrade/addon requests).
 * Previously the subscription page called /api/admin/payment-methods which
 * requires an admin_token cookie → constant 401s in the console and an empty
 * payment-method list for normal users.
 * Read-only; exposes only fields a paying customer needs.
 */
export async function GET(req: NextRequest) {
  try {
    const { requireApiAuth } = await import('@/lib/api-helpers');
    // Expired subscriptions may still pay → skipModuleGuard.
    await requireApiAuth(req, { skipModuleGuard: true });

    const s = sb();
    const { data, error: err } = await s.from('payment_methods')
      .select('id, code, name_ar, name_en, description, account_number, account_name, instructions, sort_order')
      .eq('is_active', true)
      .order('sort_order');
    if (err) {
      if ((err as { code?: string }).code === '42P01') return success({ methods: [] });
      throw err;
    }
    return success({ methods: data || [] });
  } catch (e) {
    return handleApiError(e);
  }
}
