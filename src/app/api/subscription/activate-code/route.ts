import { NextRequest } from 'next/server';
import { getSupabase } from '@/lib/supabase-client';
import { requireApiAuth, handleApiError, success, error, parseBody } from '@/lib/api-helpers';

const sb = () => getSupabase();

/**
 * POST /api/subscription/activate-code
 * Redeem an activation code for a plan upgrade OR an add-on grant.
 * SECURITY HARDENING:
 *  - CSPRNG codes cannot be guessed.
 *  - Single-use: is_used + single row update with filter is_used=false prevents double-redeem races.
 *  - target_company_id lock prevents replay across companies.
 *  - Case-insensitive, trimmed comparison.
 *  - No code value is ever logged.
 */
export async function POST(request: NextRequest) {
  try {
    const auth = await requireApiAuth(request, { skipModuleGuard: true });
    const s = sb();
    const body = await parseBody<{ code?: string }>(request);
    const code = (body.code || '').trim().toUpperCase();
    if (!code) return error('كود التفعيل مطلوب');
    if (code.length > 80) return error('كود التفعيل غير صالح');

    // Find the code (case-insensitive) — only unused, non-expired.
    const { data: rows, error: selErr } = await s.from('activation_codes')
      .select('*')
      .ilike('code', code)
      .eq('is_used', false)
      .limit(1);
    if (selErr) throw selErr;
    const ac = (rows && rows[0]) as any | null;
    if (!ac) return error('كود التفعيل غير صحيح أو مستخدم مسبقاً');

    if (ac.expires_at && new Date(ac.expires_at) < new Date()) {
      return error('كود التفعيل منتهي الصلاحية');
    }
    if (ac.target_company_id && ac.target_company_id !== auth.companyId) {
      return error('هذا الكود مخصص لشركة أخرى ولا يمكن استخدامه هنا', 403);
    }

    // Atomically mark as used — only update if still unused (defence against double-click race).
    const { data: updated, error: updErr } = await s.from('activation_codes')
      .update({
        is_used: true,
        used_by: auth.companyId,
        used_at: new Date().toISOString(),
      })
      .eq('id', ac.id).eq('company_id', auth.companyId)
      .eq('is_used', false)
      .select('*')
      .single();
    if (updErr || !updated) {
      return error('تم استخدام هذا الكود بالفعل');
    }

    // Add-on code: grant the addon directly, no plan change.
    if (ac.addon_type) {
      // Fetch current subscription
      const { data: sub, error: sErr } = await s.from('subscriptions')
        .select('id, extra_users, extra_branches, extra_storage_gb, addons_json, company_id')
        .eq('company_id', auth.companyId)
        .order('created_at', { ascending: false })
        .limit(1).maybeSingle();
      if (sErr || !sub) return error('لا يوجد اشتراك لهذه الشركة', 400);

      const curSub = sub as any;
      const qty = Number(ac.addon_quantity || 1);
      let extra_users = Number(curSub.extra_users || 0);
      let extra_branches = Number(curSub.extra_branches || 0);
      let extra_storage_gb = Number(curSub.extra_storage_gb || 0);
      const addons = (curSub.addons_json && typeof curSub.addons_json === 'object') ? curSub.addons_json : {};

      if (ac.addon_type === 'extra_user') extra_users += qty;
      if (ac.addon_type === 'extra_branch') extra_branches += qty;
      if (ac.addon_type === 'storage_gb') extra_storage_gb += qty;

      const addonKey =
        ac.addon_type === 'extra_user' ? 'extra_users_total_paid' :
        ac.addon_type === 'extra_branch' ? 'extra_branches_total_paid' :
        'extra_storage_gb_paid';
      const addonMerge = {
        ...addons,
        [addonKey]: Number(addons[addonKey] || 0) + qty,
        last_addon_purchase_at: new Date().toISOString(),
      };

      await s.from('subscriptions').update({
        extra_users, extra_branches, extra_storage_gb, addons_json: addonMerge,
        // If subscription was expired/cancelled, activating an add-on does NOT
        // automatically reactivate — only a plan code does.
        updated_at: new Date().toISOString(),
      }).eq('id', curSub.id).eq('company_id', auth.companyId);

      const addonLabelAr = ac.addon_type === 'extra_user' ? 'مستخدم إضافي'
        : ac.addon_type === 'extra_branch' ? 'فرع/مستودع إضافي'
        : 'سعة تخزين (جيجابايت)';
      return success({
        message: `✅ تم تفعيل إضافة: ${addonLabelAr} ×${qty}`,
        type: 'addon',
        addon_type: ac.addon_type,
        quantity: qty,
      });
    }

    // Plan activation
    const planCode = ac.plan_code;
    if (!planCode) return error('الكود لا يحتوي على باقة محددة');

    const { data: plan, error: pErr } = await s.from('subscription_plans')
      .select('*').eq('code', planCode).eq('is_active', true).maybeSingle();
    if (pErr || !plan) {
      return error('الباقة المرتبطة بالكود غير موجودة أو معطلة');
    }
    const planData = plan as any;

    const durationMonths = Number(ac.duration_months || ac.plan_duration_months || 1);
    const now = new Date();
    const endDate = new Date();

    const { data: currentSub } = await s.from('subscriptions')
      .select('id, end_date, status')
      .eq('company_id', auth.companyId)
      .order('created_at', { ascending: false })
      .limit(1).maybeSingle();

    let startDate = now;
    if (currentSub) {
      const curEnd = new Date((currentSub as any).end_date);
      if (curEnd > now) startDate = curEnd; // stack
    }
    endDate.setTime(startDate.getTime());
    endDate.setMonth(endDate.getMonth() + durationMonths);

    const patch = {
      plan_id: planData.id,
      plan_code: planData.code,
      status: 'active' as const,
      start_date: startDate.toISOString().split('T')[0],
      end_date: endDate.toISOString().split('T')[0],
      updated_at: new Date().toISOString(),
    };

    if (currentSub) {
      await s.from('subscriptions').update(patch).eq('id', (currentSub as any).eq('company_id', auth.companyId).id);
    } else {
      await s.from('subscriptions').insert({
        company_id: auth.companyId,
        ...patch,
      });
    }

    return success({
      message: `✅ تم تفعيل الباقة "${planData.name || planData.code}" لمدة ${durationMonths} شهر!`,
      type: 'plan',
      plan_name: planData.name || planData.description_ar || planData.code,
      plan_code: planData.code,
      duration_months: durationMonths,
      end_date: patch.end_date,
    });
  } catch (err) {
    return handleApiError(err);
  }
}

/** GET — check a code (without redeeming). */
export async function GET(request: NextRequest) {
  try {
    const auth = await requireApiAuth(request, { skipModuleGuard: true });
    const url = new URL(request.url);
    const code = (url.searchParams.get('code') || '').trim().toUpperCase();
    if (!code) return error('code مطلوب');
    const s = sb();
    const { data: rows } = await s.from('activation_codes')
      .select('*')
      .ilike('code', code)
      .eq('is_used', false)
      .limit(1);
    const ac = (rows && rows[0]) as any | null;
    if (!ac) return success({ valid: false });
    if (ac.expires_at && new Date(ac.expires_at) < new Date()) return success({ valid: false, reason: 'expired' });
    if (ac.target_company_id && ac.target_company_id !== auth.companyId) {
      return success({ valid: false, reason: 'wrong_company' });
    }
    if (ac.addon_type) {
      return success({
        valid: true, type: 'addon', addon_type: ac.addon_type, quantity: ac.addon_quantity,
      });
    }
    const { data: plan } = await s.from('subscription_plans').select('name, code, description_ar')
      .eq('code', ac.plan_code).eq('is_active', true).maybeSingle();
    return success({
      valid: true, type: 'plan',
      plan_name: (plan as any)?.name || ac.plan_code,
      duration_months: ac.duration_months || ac.plan_duration_months,
    });
  } catch (err) { return handleApiError(err); }
}
