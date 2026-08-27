import { createHash } from 'crypto';
import { NextRequest } from 'next/server';
import { getSupabase } from '@/lib/supabase-client';
import { requireApiAuth, handleApiError, success, error, parseBody } from '@/lib/api-helpers';

import type { Row } from '@/lib/types';

const sb = () => getSupabase();
const CODE_PATTERN = /^[A-F0-9-]{16,80}$/;

function normalizeCode(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  const code = value.trim().toUpperCase();
  return CODE_PATTERN.test(code) ? code : null;
}

/**
 * Redeem a one-time plan/add-on code.
 *
 * The RPC owns the row lock and changes the subscription in the same database
 * transaction as marking the code used. A failed entitlement write therefore
 * cannot consume the code, and concurrent requests cannot grant twice.
 */
export async function POST(request: NextRequest) {
  try {
    const auth = await requireApiAuth(request, { skipModuleGuard: true });
    const body = await parseBody<{ code?: string }>(request);
    const code = normalizeCode(body.code);
    if (!code) return error('كود التفعيل غير صالح');

    const { data, error: rpcError } = await sb().rpc('redeem_activation_code', {
      p_company_id: auth.companyId,
      p_user_id: auth.userId,
      p_code: code,
    });
    if (rpcError) {
      const message = String(rpcError.message || '');
      if (/another company/i.test(message)) return error('هذا الكود مخصص لشركة أخرى', 403);
      if (/expired/i.test(message)) return error('كود التفعيل منتهي الصلاحية', 400);
      if (/invalid|already used/i.test(message)) return error('كود التفعيل غير صحيح أو مستخدم مسبقاً', 400);
      if (/no subscription/i.test(message)) return error('لا يوجد اشتراك لهذه الشركة', 400);
      throw rpcError;
    }

    const result = (data || {}) as Record<string, unknown>;
    if (result.type === 'addon') {
      return success({
        ...result,
        message: 'تم تفعيل الإضافة بنجاح',
      });
    }
    return success({
      ...result,
      message: 'تم تفعيل الباقة بنجاح',
    });
  } catch (err) {
    return handleApiError(err);
  }
}

/** Check code metadata without consuming it. Never returns the code itself. */
export async function GET(request: NextRequest) {
  try {
    const auth = await requireApiAuth(request, { skipModuleGuard: true });
    const code = normalizeCode(new URL(request.url).searchParams.get('code'));
    if (!code) return success({ valid: false });

    const s = sb();
    const digest = createHash('sha256').update(code).digest('hex');
    const codeResult = await s.from('activation_codes')
      .select('id, plan_code, duration_months, plan_duration_months, addon_type, addon_quantity, expires_at, target_company_id, company_id, is_used')
      .eq('code_hash', digest)
      .eq('is_used', false)
      .maybeSingle();
    if (codeResult.error) throw codeResult.error;
    let ac = codeResult.data;

    // Backward compatibility for codes created before migration 049.
    if (!ac) {
      const legacy = await s.from('activation_codes')
        .select('id, plan_code, duration_months, plan_duration_months, addon_type, addon_quantity, expires_at, target_company_id, company_id, is_used')
        .ilike('code', code)
        .eq('is_used', false)
        .limit(1)
        .maybeSingle();
      if (legacy.error) throw legacy.error;
      ac = legacy.data;
    }

    if (!ac) return success({ valid: false });
    const row = ac as Row;
    if (row.expires_at && new Date(String(row.expires_at)).getTime() < Date.now()) {
      return success({ valid: false, reason: 'expired' });
    }
    const target = row.target_company_id || row.company_id;
    if (target && target !== auth.companyId) {
      return success({ valid: false, reason: 'wrong_company' });
    }
    if (row.addon_type) {
      return success({ valid: true, type: 'addon', addon_type: row.addon_type, quantity: row.addon_quantity });
    }

    const { data: plan, error: planError } = await s.from('subscription_plans')
      .select('name, code, description_ar')
      .eq('code', row.plan_code)
      .eq('is_active', true)
      .maybeSingle();
    if (planError) throw planError;
    if (!plan) return success({ valid: false, reason: 'plan_unavailable' });
    return success({
      valid: true,
      type: 'plan',
      plan_name: (plan as Row).name || row.plan_code,
      duration_months: row.duration_months || row.plan_duration_months,
    });
  } catch (err) {
    return handleApiError(err);
  }
}
