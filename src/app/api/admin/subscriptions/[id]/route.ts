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
    const s = sb();
    const { data, error: err } = await s.from('subscriptions')
      .select(`*, subscription_plans(*), companies(id,name,email,phone)`)
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
    const body = await parseBody<{
      plan_id?: string;
      status?: string;
      end_date?: string;
      extra_users?: number | '';
      extra_branches?: number | '';
      notes?: string;
    }>(req);

    const s = sb();
    const { data: existing } = await s.from('subscriptions').select('id,company_id,extra_users,extra_branches').eq('id', id).maybeSingle();
    if (!existing) return error('الاشتراك غير موجود', 404);

    const patch: Record<string, any> = { updated_at: new Date().toISOString() };
    if (body.plan_id) patch.plan_id = body.plan_id;
    if (body.status && ['active','trial','cancelled','expired'].includes(body.status)) patch.status = body.status;
    if (body.end_date) patch.end_date = body.end_date;
    if (body.extra_users !== undefined) patch.extra_users = normInt(body.extra_users, 0) ?? 0;
    if (body.extra_branches !== undefined) patch.extra_branches = normInt(body.extra_branches, 0) ?? 0;

    const prev = existing as any;
    const { data: updated, error: uErr } = await s.from('subscriptions').update(patch).eq('id', id).select().single();
    if (uErr) throw uErr;

    // Audit changes to addons
    if (patch.extra_users !== undefined || patch.extra_branches !== undefined) {
      try { await s.from('addon_grant_audit').insert({
        company_id: prev.company_id,
        admin_id: admin.adminId,
        addon_type: patch.extra_users !== undefined ? 'extra_user' : 'extra_branch',
        quantity: Math.abs(Number(patch.extra_users ?? prev.extra_users) - Number(prev.extra_users ?? 0))
               + Math.abs(Number(patch.extra_branches ?? prev.extra_branches) - Number(prev.extra_branches ?? 0)),
        months_granted: 0,
        previous_extra_users: Number(prev.extra_users || 0),
        previous_extra_branches: Number(prev.extra_branches || 0),
        new_extra_users: Number(patch.extra_users ?? prev.extra_users),
        new_extra_branches: Number(patch.extra_branches ?? prev.extra_branches),
        note: body.notes || 'manual admin adjustment',
      }); } catch {}
    }

    return success({ subscription: updated });
  } catch (e) { return adminJsonError(e); }
}
