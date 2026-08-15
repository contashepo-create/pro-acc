import { requireAdmin, adminJsonError } from '@/lib/admin-guard';
import { NextRequest } from 'next/server';
import { createHash, randomBytes } from 'crypto';
import { auditLog } from '@/lib/admin-auth';
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

    let queryBuilder = s.from('activation_codes').select('*');
    if (used === 'true') queryBuilder = queryBuilder.eq('is_used', true);
    else if (used === 'false') queryBuilder = queryBuilder.eq('is_used', false);
    queryBuilder = queryBuilder.order('created_at', { ascending: false });

    const { data: codes, error: err } = await queryBuilder.limit(500);
    if (err) throw err;

    const companyIds = (codes || []).map((c: any) => c.target_company_id || c.used_by).filter(Boolean);
    const companyMap: Record<string, string> = {};
    if (companyIds.length > 0) {
      const { data: companies } = await s.from('companies').select('id, name').in('id', [...new Set(companyIds)]);
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
    if (body.expiresAt && (!/^\d{4}-\d{2}-\d{2}/.test(body.expiresAt) || new Date(body.expiresAt).getTime() <= Date.now())) {
      return error('تاريخ انتهاء الكود غير صالح');
    }

    // Lock plan/company targets before creating any secrets.
    const s = sb();
    if (body.companyId) {
      const { data: company } = await s.from('companies').select('id').eq('id', body.companyId).maybeSingle();
      if (!company) return error('الشركة المستهدفة غير موجودة', 404);
    }
    if (!isAddon) {
      const { data: plan } = await s.from('subscription_plans')
        .select('id, code, is_active').eq('code', body.planCode!).eq('is_active', true).maybeSingle();
      if (!plan) return error('الباقة غير موجودة أو معطلة', 404);
    }

    const n = Math.max(1, Math.min(50, Number(body.count) || 1));
    const codes: string[] = [];

    for (let i = 0; i < n; i++) {
      // Generate, retrying on collision (the unique hash index is authoritative).
      let generated = '';
      let inserted = false;
      for (let attempt = 0; attempt < 8; attempt++) {
        generated = genCode();
        const codeHash = createHash('sha256').update(generated.toUpperCase()).digest('hex');
        const { error: insErr } = await s.from('activation_codes').insert({
          // Plaintext activation secrets are never persisted. They are returned
          // once below; only the SHA-256 lookup digest remains in the database.
          code: null,
          code_hash: codeHash,
          plan_code: isAddon ? null : body.planCode!,
          duration_months: isAddon ? null : Number(body.durationMonths),
          plan_duration_months: isAddon ? null : Number(body.durationMonths),
          target_company_id: body.companyId || null,
          expires_at: body.expiresAt || null,
          addon_type: isAddon ? body.addonType! : null,
          addon_quantity: isAddon ? Number(body.addonQuantity) : null,
          notes: typeof body.notes === 'string' ? body.notes.slice(0, 1000) : null,
          is_used: false,
          one_time: true,
        });
        if (!insErr) { inserted = true; break; }
        if (insErr.code === '23505') continue;
        throw insErr;
      }
      if (!inserted) throw new Error('تعذر إنشاء كود فريد بعد عدة محاولات');
      codes.push(generated);
    }

    await auditLog(
      admin.adminId,
      'create_activation_codes',
      JSON.stringify({ count: codes.length, planCode: body.planCode || null, addonType: body.addonType || null, targetCompanyId: body.companyId || null }),
      'activation_code_batch'
    );
    return success({ codes, count: codes.length }, 201);
  } catch (e) {
    return adminJsonError(e);
  }
}
