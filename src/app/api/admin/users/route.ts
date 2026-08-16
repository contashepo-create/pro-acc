import { requireAdmin, adminJsonError } from '@/lib/admin-guard';
import { NextRequest } from 'next/server';
import { getSupabase } from '@/lib/supabase-client';
import { success, error } from '@/lib/api-helpers';

const sb = () => getSupabase();
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;



// Get all users with full profile data
export async function GET(req: NextRequest) {
  try {
    await requireAdmin(req);
    const userId = req.nextUrl.searchParams.get('user_id');
    const companyId = req.nextUrl.searchParams.get('company_id');
    if (userId && !UUID.test(userId)) return error('معرّف المستخدم غير صالح');
    if (companyId && !UUID.test(companyId)) return error('معرّف الشركة غير صالح');

    const s = sb();

    if (userId) {
      // Get single user with full profile (NEVER select password_hash)
      const { data: user, error: userError } = await s
        .from('users')
        .select(`
          id, name, email, role, is_active, email_verified, last_login,
          last_activity, created_at, updated_at, company_id,
          company:companies!inner(
            id, name, commercial_registration, tax_number,
            phone, email, address, currency_symbol,
            is_active, created_at, updated_at
          ),
          permissions:user_permissions(
            module, permissions, bypass_telegram_confirmation
          )
        `)
        .eq('id', userId)
        .maybeSingle();

      if (userError) throw userError;
      if (!user) return error('المستخدم غير موجود', 404);

      // Admin audit records use target_type/target_id (not the tenant audit
      // table's entity_type/entity_id shape). Scope activity to this user.
      const { data: activity, error: activityError } = await s
        .from('admin_audit_log')
        .select('id, action, details, target_type, target_id, created_at, admin_id')
        .eq('target_type', 'user')
        .eq('target_id', userId)
        .order('created_at', { ascending: false })
        .limit(20);
      if (activityError) throw activityError;

      // Get subscription info (explicit column list — no password/token fields)
      const { data: subscription, error: subscriptionError } = await s
        .from('subscriptions')
        .select(`
          id, subscriber_number, plan_id, plan_code, status,
          start_date, end_date, trial_end_date, auto_renew,
          extra_users, extra_branches, extra_storage_gb, addons_json, created_at,
          plan:subscription_plans(
            id, code, name, currency, price_monthly, price_yearly, max_users,
            max_invoices_per_month, max_quotations_per_month, max_storage_mb,
            features, features_modules
          )
        `)
        .eq('company_id', (user as any).company_id)
        .order('created_at', { ascending: false })
        .limit(1)
        .maybeSingle();
      if (subscriptionError) throw subscriptionError;

      return success({
        user,
        activity: activity || [],
        subscription,
      });
    }

    if (companyId) {
      // Get all users for a company — NEVER return password_hash/token fields
      const { data: users, error: usersError } = await s
        .from('users')
        .select('id, name, email, role, is_active, email_verified, last_login, last_activity, created_at, updated_at, company_id')
        .eq('company_id', companyId)
        .order('created_at', { ascending: false });

      if (usersError) throw usersError;
      return success(users || []);
    }

    // Get all users with companies (safe columns only)
    const { data: users, error: usersError } = await s
      .from('users')
      .select(`
        id, name, email, role, is_active, email_verified, last_login, last_activity, created_at, updated_at, company_id,
        company:companies(
          id, name, is_active
        )
      `)
      .order('created_at', { ascending: false })
      .limit(100);

    if (usersError) throw usersError;

    return success(users || []);
  } catch (e: any) {
    return adminJsonError(e);
  }
}