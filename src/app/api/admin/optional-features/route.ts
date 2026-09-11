import { NextRequest } from 'next/server';
import { requireAdmin, adminJsonError } from '@/lib/admin-guard';
import { getSupabase } from '@/lib/supabase-client';
import { success, error, parseBody } from '@/lib/api-helpers';

const sb = () => getSupabase();
export async function GET(req: NextRequest) {
  try { await requireAdmin(req); const { data, error: e } = await sb().from('companies').select('id,name,optional_features,additional_users_limit').order('name'); if (e) throw e; return success({ companies: data || [] }); } catch (e) { return adminJsonError(e); }
}
export async function PATCH(req: NextRequest) {
  try {
    await requireAdmin(req);
    const body = await parseBody<{ companyId?: string; taxBarcode?: boolean; additionalUsers?: boolean; additionalUsersLimit?: number }>(req);
    if (!body.companyId) return error('الشركة مطلوبة');
    if (body.additionalUsersLimit !== undefined && (!Number.isInteger(body.additionalUsersLimit) || body.additionalUsersLimit < 0 || body.additionalUsersLimit > 10)) return error('عدد المستخدمين الإضافيين يجب أن يكون بين 0 و10');
    const { data: current, error: readError } = await sb().from('companies').select('optional_features,additional_users_limit').eq('id', body.companyId).maybeSingle();
    if (readError) throw readError; if (!current) return error('الشركة غير موجودة', 404);
    const features = { ...((current.optional_features || {}) as Record<string, boolean>) };
    if (body.taxBarcode !== undefined) features.tax_barcode = body.taxBarcode;
    if (body.additionalUsers !== undefined) features.additional_users = body.additionalUsers;
    const limit = body.additionalUsersLimit ?? Number(current.additional_users_limit || 0);
    const { data, error: updateError } = await sb().from('companies').update({ optional_features: features, additional_users_limit: limit }).eq('id', body.companyId).select('id,name,optional_features,additional_users_limit').single();
    if (updateError) throw updateError;
    return success({ company: data });
  } catch (e) { return adminJsonError(e); }
}
