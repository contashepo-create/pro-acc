import { NextRequest } from 'next/server';
import { getSupabase } from '@/lib/supabase-client';
import { success, error, serverError } from '@/lib/api-helpers';
import { verifyToken } from '@/lib/auth';

const sb = () => getSupabase();

function requireAdmin(request: NextRequest) {
  const token = request.cookies.get('admin_token')?.value;
  if (!token) throw new Error('Unauthorized');
  const payload = verifyToken(token);
  if (!payload || payload.role !== 'superadmin') throw new Error('Unauthorized');
  return payload;
}

// Get all users with full profile data
export async function GET(req: NextRequest) {
  try {
    const admin = requireAdmin(req);
    const userId = req.nextUrl.searchParams.get('user_id');
    const companyId = req.nextUrl.searchParams.get('company_id');

    const s = sb();

    if (userId) {
      // Get single user with full profile
      const { data: user, error: userError } = await s
        .from('users')
        .select(`
          *,
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
        .single();

      if (userError) throw userError;

      // Get user activity
      const { data: activity } = await s
        .from('admin_audit_log')
        .select('*')
        .order('created_at', { ascending: false })
        .limit(20);

      // Get subscription info
      const { data: subscription } = await s
        .from('subscriptions')
        .select(`
          *,
          plan:subscription_plans(
            id, name, price_monthly, max_users, features
          )
        `)
        .eq('company_id', (user as any).company_id)
        .eq('status', 'active')
        .single();

      return success({
        user,
        activity: activity || [],
        subscription,
      });
    }

    if (companyId) {
      // Get all users for a company
      const { data: users, error: usersError } = await s
        .from('users')
        .select('*')
        .eq('company_id', companyId)
        .order('created_at', { ascending: false });

      if (usersError) throw usersError;
      return success(users || []);
    }

    // Get all users with companies
    const { data: users, error: usersError } = await s
      .from('users')
      .select(`
        *,
        company:companies(
          id, name, is_active
        )
      `)
      .order('created_at', { ascending: false })
      .limit(100);

    if (usersError) throw usersError;

    return success(users || []);
  } catch (e: any) {
    if (e.message === 'Unauthorized') return error('Unauthorized', 401);
    return serverError(e);
  }
}