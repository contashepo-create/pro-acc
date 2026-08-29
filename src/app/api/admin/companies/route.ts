import { requireAdmin, adminJsonError } from '@/lib/admin-guard';
import { NextRequest } from 'next/server';
import { getSupabase } from '@/lib/supabase-client';
import { success, getPaginationParams } from '@/lib/api-helpers';

import type { Row } from '@/lib/types';

const sb = () => getSupabase();

export async function GET(request: NextRequest) {
  try {
    await requireAdmin(request);

    const { page, pageSize } = getPaginationParams(request.url);
    const s = sb();

    // Server-side search (q): name / tax number / CR, or the subscriber
    // number. The number lives on subscriptions, so resolve the matching
    // company id set first, then constrain both the count and the page —
    // the developer panel relies on this to handle a subscriber by the
    // number they send over chat, no matter how many companies exist.
    const q = (new URL(request.url).searchParams.get('q') || '').trim();
    let searchIds: string[] | null = null;
    if (q) {
      const safe = q.replace(/[%_\\]/g, '');
      const [nameRes, numRes] = await Promise.all([
        s.from('companies')
          .select('id')
          .or(`name.ilike.%${safe}%,tax_number.ilike.%${safe}%,commercial_registration.ilike.%${safe}%`),
        s.from('subscriptions').select('company_id').ilike('subscriber_number', `%${safe}%`),
      ]);
      if (nameRes.error) throw nameRes.error;
      if (numRes.error) throw numRes.error;
      const ids = new Set<string>();
      (nameRes.data || []).forEach((r: Row) => ids.add(String(r.id)));
      (numRes.data || []).forEach((r: Row) => { if (r.company_id) ids.add(String(r.company_id)); });
      searchIds = [...ids];
      if (searchIds.length === 0) {
        return success({ companies: [], total: 0, page, pageSize });
      }
    }

    const { count: total, error: countErr } = await (searchIds
      ? s.from('companies').select('*', { count: 'exact', head: true }).in('id', searchIds)
      : s.from('companies').select('*', { count: 'exact', head: true }));
    if (countErr) throw countErr;

    const from = (page - 1) * pageSize;
    const to = from + pageSize - 1;

    let listQuery = s.from('companies')
      .select('id, name, commercial_registration, tax_number, address, phone, email, is_active, created_at, country, country_code, currency_code, vat_rate')
      .order('created_at', { ascending: false });
    if (searchIds) listQuery = listQuery.in('id', searchIds);
    const { data: companies, error: err } = await listQuery.range(from, to);
    if (err) throw err;

    const companyIds = (companies || []).map((c: Row) => c.id);

    // Get user counts per company
    const userCountMap: Record<string, number> = {};
    if (companyIds.length > 0) {
      const { data: users, error: usersError } = await s.from('users')
        .select('company_id')
        .in('company_id', companyIds);
      if (usersError) throw usersError;
      (users || []).forEach((u: Row) => {
        const uid = String(u.company_id);
        userCountMap[uid] = (userCountMap[uid] || 0) + 1;
      });
    }

    // Get subscription info per company
    const subMap: Record<string, unknown> = {};
    if (companyIds.length > 0) {
      const { data: subs, error: subscriptionsError } = await s.from('subscriptions')
        .select('id, company_id, subscriber_number, plan_id, plan_code, status, start_date, end_date, trial_end_date, auto_renew, subscription_plans(name, max_users, max_projects)')
        .in('company_id', companyIds)
        .order('created_at', { ascending: false });
      if (subscriptionsError) throw subscriptionsError;
      (subs || []).forEach((sub: Row) => {
        const sid = String(sub.company_id);
        if (!subMap[sid]) {
          const sp = (sub.subscription_plans ?? null) as Row | null;
          subMap[sid] = {
            subscriber_number: sub.subscriber_number,
            plan_code: sub.plan_code,
            plan_name: sp?.name || sub.plan_code || '—',
            status: sub.status,
            start_date: sub.start_date,
            end_date: sub.end_date,
            auto_renew: sub.auto_renew,
            max_users: sp?.max_users,
            max_projects: sp?.max_projects,
          };
        }
      });
    }

    const result = (companies || []).map((c: Row) => ({
      ...c,
      user_count: userCountMap[String(c.id)] || 0,
      subscription: subMap[String(c.id)] || null,
    }));

    return success({
      companies: result,
      total: total || 0,
      page,
      pageSize,
    });
  } catch (err) {
    return adminJsonError(err);
  }
}
