import { NextRequest } from 'next/server';
import { getSupabase } from '@/lib/supabase-client';
import { success, error, serverError, parseBody } from '@/lib/api-helpers';
import { verifyToken } from '@/lib/auth';

// @ts-ignore
const sb = () => getSupabase() as any;

function requireAdmin(request: NextRequest) {
  const token = request.cookies.get('admin_token')?.value;
  if (!token) throw new Error('Unauthorized');
  const payload = verifyToken(token);
  if (!payload || payload.role !== 'superadmin') throw new Error('Unauthorized');
  return payload;
}

export async function GET(req: NextRequest) {
  try {
    requireAdmin(req);
    const s = sb();
    const status = req.nextUrl.searchParams.get('status') || 'pending';

    let query = s.from('upgrade_requests')
      .select('*, companies(name, email, phone), subscription_plans!requested_plan_id(name, code), users!user_id(name, email)')
      .order('created_at', { ascending: false });

    if (status !== 'all') {
      query = query.eq('status', status);
    }

    const { data, error: err } = await query;
    if (err) throw err;

    return success({ requests: data || [] });
  } catch (e: any) {
    if (e.message === 'Unauthorized') return error('Unauthorized', 401);
    return serverError(e);
  }
}

export async function PUT(req: NextRequest) {
  try {
    const admin = requireAdmin(req);
    const body = await parseBody(req);
    const { id, status, admin_notes } = body;

    if (!id || !status) return error('id and status required');
    if (!['approved', 'rejected'].includes(status)) return error('Invalid status');

    const s = sb();

    const { data: existing } = await s.from('upgrade_requests')
      .select('*, companies(id)')
      .eq('id', id)
      .single();

    if (!existing) return error('Request not found', 404);

    const { data: updated, error: updateErr } = await s.from('upgrade_requests')
      .update({
        status,
        admin_notes,
        reviewed_by: admin.userId,
        reviewed_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      })
      .eq('id', id)
      .select()
      .single();

    if (updateErr) throw updateErr;

    // If approved, upgrade the subscription
    if (status === 'approved') {
      const reqData: any = existing;
      const durationDays = reqData.duration_type === 'yearly' ? 365 : 30;
      const endDate = new Date();
      endDate.setDate(endDate.getDate() + durationDays);

      // Get plan code
      const { data: plan } = await s.from('subscription_plans').select('code').eq('id', reqData.requested_plan_id).single();

      // Update or create subscription
      const { data: currentSub } = await s.from('subscriptions')
        .select('id')
        .eq('company_id', reqData.company_id)
        .order('created_at', { ascending: false })
        .limit(1)
        .single();

      if (currentSub) {
        await s.from('subscriptions').update({
          plan_id: reqData.requested_plan_id,
          plan_code: (plan as any)?.code || 'pro',
          status: 'active',
          end_date: endDate.toISOString().split('T')[0],
          updated_at: new Date().toISOString(),
        }).eq('id', (currentSub as any).id);
      } else {
        await s.from('subscriptions').insert({
          company_id: reqData.company_id,
          plan_id: reqData.requested_plan_id,
          plan_code: (plan as any)?.code || 'pro',
          status: 'active',
          start_date: new Date().toISOString().split('T')[0],
          end_date: endDate.toISOString().split('T')[0],
        });
      }

      // Notify company
      await s.from('notifications').insert({
        company_id: reqData.company_id,
        title: 'تمت الموافقة على طلب الترقية',
        body: `تمت الموافقة على ترقيتك إلى باقة ${(plan as any)?.code}. استمتع بالمميزات الجديدة!`,
        type: 'subscription',
      });
    }

    return success({ request: updated });
  } catch (e: any) {
    if (e.message === 'Unauthorized') return error('Unauthorized', 401);
    return serverError(e);
  }
}
