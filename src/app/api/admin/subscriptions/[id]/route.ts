import { requireAdmin, adminJsonError } from '@/lib/admin-guard';
import { NextRequest } from 'next/server';
import { getSupabase } from '@/lib/supabase-client';
import { success, error, parseBody } from '@/lib/api-helpers';

const sb = () => getSupabase();

function normInt(v: unknown, def: number | null = null): number | null {
  if (v === null || v === undefined || v === '') return def;
  const n = Number(v);
  if (!Number.isFinite(n)) return def;
  return Math.max(0, Math.floor(n));
}

export async function GET(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    await requireAdmin(_req);
    const { id } = await params;
    if (!/^[0-9a-fA-F-]{8,}$/.test(id)) return error('معرّف الاشتراك غير صالح', 400);
    const s = sb();
    const { data, error: err } = await s.from('subscriptions')
      .select(`
        id, subscriber_number, company_id, plan_id, plan_code, status,
        start_date, end_date, trial_end_date, auto_renew,
        extra_users, extra_branches, extra_storage_gb, addons_json,
        created_at, updated_at,
        subscription_plans(
          id, code, name, description_ar, currency, price_monthly, price_yearly,
          trial_days, max_users, max_invoices_per_month, max_quotations_per_month,
          max_storage_mb, max_branches, features_modules, is_active
        ),
        companies(id,name,email,phone)
      `)
      .eq('id', id).maybeSingle();
    if (err) throw err;
    if (!data) return error('الاشتراك غير موجود', 404);
    return success({ subscription: data });
  } catch (e) { return adminJsonError(e); }
}

export async function PUT(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const admin = await requireAdmin(req);
    const { id } = await params;
    if (!/^[0-9a-fA-F-]{8,}$/.test(id)) return error('معرّف الاشتراك غير صالح', 400);
    const body = await parseBody<{
      plan_id?: string;
      status?: string;
      end_date?: string;
      extra_users?: number | '';
      extra_branches?: number | '';
      extra_storage_gb?: number | '';
      notes?: string;
    }>(req);

    const s = sb();
    const { data: existing } = await s.from('subscriptions').select('id,company_id,extra_users,extra_branches,extra_storage_gb').eq('id', id).maybeSingle();
    if (!existing) return error('الاشتراك غير موجود', 404);

    const patch: Record<string, any> = { updated_at: new Date().toISOString() };
    if (body.plan_id) patch.plan_id = body.plan_id;
    if (body.status && ['active','trial','cancelled','expired'].includes(body.status)) patch.status = body.status;
    if (body.end_date) patch.end_date = body.end_date;
    if (body.extra_users !== undefined) patch.extra_users = normInt(body.extra_users, 0) ?? 0;
    if (body.extra_branches !== undefined) patch.extra_branches = normInt(body.extra_branches, 0) ?? 0;
    if (body.extra_storage_gb !== undefined) patch.extra_storage_gb = normInt(body.extra_storage_gb, 0) ?? 0;

    const prev = existing as any;
    const { data: updated, error: uErr } = await s.from('subscriptions').update(patch).eq('id', id).select().single();
    if (uErr) throw uErr;

    // Audit changes to addons
    const addonChanged = patch.extra_users !== undefined
      || patch.extra_branches !== undefined
      || patch.extra_storage_gb !== undefined;
    if (addonChanged) {
      const addonType =
        patch.extra_users !== undefined ? 'extra_user' :
        patch.extra_branches !== undefined ? 'extra_branch' :
        'storage_gb';
      const newUsers = Number(patch.extra_users ?? prev.extra_users ?? 0);
      const newBranches = Number(patch.extra_branches ?? prev.extra_branches ?? 0);
      const prevUsers = Number(prev.extra_users || 0);
      const prevBranches = Number(prev.extra_branches || 0);
      const qty = addonType === 'extra_user' ? Math.abs(newUsers - prevUsers)
        : addonType === 'extra_branch' ? Math.abs(newBranches - prevBranches)
        : Math.abs(Number(patch.extra_storage_gb ?? prev.extra_storage_gb ?? 0) - Number(prev.extra_storage_gb || 0));
      try { await s.from('addon_grant_audit').insert({
        company_id: prev.company_id,
        admin_id: admin.adminId,
        addon_type: addonType,
        quantity: qty,
        months_granted: 0,
        previous_extra_users: prevUsers,
        previous_extra_branches: prevBranches,
        new_extra_users: newUsers,
        new_extra_branches: newBranches,
        note: body.notes || 'manual admin adjustment',
      }); } catch {}
    }

    return success({ subscription: updated });
  } catch (e) { return adminJsonError(e); }
}
