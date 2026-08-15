import { requireAdmin, adminJsonError } from '@/lib/admin-guard';
import { NextRequest } from 'next/server';
import { createHash, randomBytes } from 'crypto';
import { getSupabase } from '@/lib/supabase-client';
import { success, error, parseBody } from '@/lib/api-helpers';

const sb = () => getSupabase();

/**
 * Generate a cryptographically strong activation code.
 * 16 bytes → 32 hex chars, split into 4 groups of 8 for readability.
 * Total keyspace: 2^128 ≈ 3.4×10^38 codes — brute-force impossible
 * even at billions of guesses/second. No deterministic HMAC over
 * predictable fields (planCode/companyId) because that lets attackers
 * enumerate likely codes offline with just the salt guess.
 */
function genCode(): string {
  // e.g. A3F9...-B2C1...-D4E5...-F6A7... (32 hex chars, uppercase)
  const hex = randomBytes(16).toString('hex').toUpperCase();
  return `${hex.slice(0,8)}-${hex.slice(8,16)}-${hex.slice(16,24)}-${hex.slice(24,32)}`;
}

export async function GET(req: NextRequest) {
  try {
    await requireAdmin(req);
    const s = sb();
    const used = req.nextUrl.searchParams.get('used');
    if (used && used !== 'true' && used !== 'false') return error('حالة كود التفعيل غير صالحة');

    let queryBuilder = s.from('activation_codes').select(
      'id, code, plan_code, duration_months, company_id, target_company_id, is_used, used_by, used_at, expires_at, created_by, created_at, addon_type, addon_quantity, plan_duration_months, notes, one_time'
    );
    if (used === 'true') queryBuilder = queryBuilder.eq('is_used', true);
    else if (used === 'false') queryBuilder = queryBuilder.eq('is_used', false);
    queryBuilder = queryBuilder.order('created_at', { ascending: false });

    const { data: codes, error: err } = await queryBuilder.limit(500);
    if (err) throw err;

    const companyIds = (codes || []).map((c: any) => c.target_company_id || c.used_by).filter(Boolean);
    const companyMap: Record<string, string> = {};
    if (companyIds.length > 0) {
      const { data: companies, error: companiesError } = await s.from('companies').select('id, name').in('id', [...new Set(companyIds)]);
      if (companiesError) throw companiesError;
      (companies || []).forEach((c: any) => { companyMap[c.id] = c.name; });
    }

    const result = (codes || []).map((c: any) => ({
      id: c.id,
      // Never return a redeemable secret from a list endpoint. The plaintext
      // is shown exactly once in the POST response.
      code: c.code ? `••••-${String(c.code).slice(-8)}` : '••••-••••',
      plan_code: c.plan_code,
      duration_months: c.duration_months || c.plan_duration_months,
      addon_type: c.addon_type,
      addon_quantity: c.addon_quantity,
      expires_at: c.expires_at,
      is_used: c.is_used,
      used_by: c.used_by,
      used_at: c.used_at,
      target_company_id: c.target_company_id,
      target_company_name: c.target_company_id ? companyMap[c.target_company_id] : null,
      used_company_name: c.used_by ? companyMap[c.used_by] : null,
      notes: c.notes || null,
      created_at: c.created_at,
    }));

    return success({ codes: result });
  } catch (e) {
    return adminJsonError(e);
  }
}

export async function POST(req: NextRequest) {
  try {
    const admin = await requireAdmin(req);
    const body = await parseBody<{
      planCode?: string;
      durationMonths?: number;
      companyId?: string;         // lock code to a specific company
      expiresAt?: string;
      addonType?: 'extra_user'|'extra_branch'|'storage_gb'|null;
      addonQuantity?: number;
      notes?: string;
      count?: number;
    }>(req);

    const isAddon = !!body.addonType;
    if (!isAddon && (!body.planCode || !body.durationMonths)) {
      return error('planCode و durationMonths مطلوبان (أو addonType لإضافة)');
    }
    if (isAddon && (!Number.isInteger(Number(body.addonQuantity)) || Number(body.addonQuantity) < 1 || Number(body.addonQuantity) > 10000)) {
      return error('كمية الإضافة غير صالحة');
    }
    if (!isAddon && (!Number.isInteger(Number(body.durationMonths)) || Number(body.durationMonths) < 1 || Number(body.durationMonths) > 120)) {
      return error('مدة التفعيل يجب أن تكون بين شهر و120 شهراً');
    }
    if (body.planCode && !/^[a-z0-9_-]{2,32}$/i.test(body.planCode)) return error('كود الباقة غير صالح');
    if (body.companyId && !/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(body.companyId)) {
      return error('معرّف الشركة غير صالح');
    }
    if (body.expiresAt && (!/^\d{4}-\d{2}-\d{2}$/.test(body.expiresAt) || new Date(`${body.expiresAt}T23:59:59Z`).getTime() <= Date.now())) {
      return error('تاريخ انتهاء الكود غير صالح');
    }
    if (body.notes !== undefined && (typeof body.notes !== 'string' || body.notes.length > 1000)) return error('الملاحظات غير صالحة');
    const n = body.count === undefined ? 1 : Number(body.count);
    if (!Number.isSafeInteger(n) || n < 1 || n > 50) return error('عدد الأكواد يجب أن يكون بين 1 و50');
    const codes = Array.from({ length: n }, () => genCode());
    const hashes = codes.map((code) =>
      createHash('sha256').update(code.toUpperCase()).digest('hex')
    );

    // Target validation, all code inserts, and the admin audit record commit as
    // one transaction. No partially-created batch can survive an RPC failure.
    const { error: createError } = await sb().rpc('create_activation_code_batch_atomic', {
      p_admin_id: admin.adminId,
      p_plan_code: isAddon ? null : body.planCode!,
      p_duration_months: isAddon ? null : Number(body.durationMonths),
      p_company_id: body.companyId || null,
      p_expires_at: body.expiresAt || null,
      p_addon_type: isAddon ? body.addonType! : null,
      p_addon_quantity: isAddon ? Number(body.addonQuantity) : null,
      p_notes: typeof body.notes === 'string' ? body.notes : null,
      p_hashes: hashes,
    });
    if (createError) {
      const message = String(createError.message || '');
      if (/company not found/i.test(message)) return error('الشركة المستهدفة غير موجودة', 404);
      if (/plan is unavailable/i.test(message)) return error('الباقة غير موجودة أو معطلة', 404);
      if (createError.code === '23505') return error('حدث تعارض نادر أثناء إنشاء الأكواد، حاول مجدداً', 409);
      throw createError;
    }

    return success({ codes, count: codes.length }, 201);
  } catch (e) {
    return adminJsonError(e);
  }
}
