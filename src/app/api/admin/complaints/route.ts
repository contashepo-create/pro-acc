import { NextRequest } from 'next/server';
import { getSupabase } from '@/lib/supabase-client';
import { success, error, parseBody } from '@/lib/api-helpers';
import { requireAdmin, adminJsonError } from '@/lib/admin-guard';
import { adminComplaintPatchSchema } from '@/lib/communication-validation';

const sb = () => getSupabase();

const ALLOWED_STATUSES = new Set(['pending', 'read', 'replied', 'closed']);

export async function GET(request: NextRequest) {
  try {
    await requireAdmin(request);
    const { searchParams } = new URL(request.url);
    const status = searchParams.get('status') || '';

    if (status && !ALLOWED_STATUSES.has(status)) return error('حالة غير صالحة');
    const s = sb();
    let queryBuilder = s.from('complaints')
      .select('id, type, subject, body, status, admin_reply, created_at, company_id, replied_at')
      .is('deleted_at', null)
      .order('created_at', { ascending: false })
      .limit(100);

    if (status && ALLOWED_STATUSES.has(status)) {
      queryBuilder = queryBuilder.eq('status', status);
    }

    const { data: complaints, error: err } = await queryBuilder;
    if (err) throw err;

    const companyIds = (complaints || []).map((c: any) => c.company_id).filter(Boolean);
    const companyMap: Record<string, string> = {};
    if (companyIds.length > 0) {
      const { data: companies, error: companiesError } = await s.from('companies')
        .select('id, name')
        .in('id', [...new Set(companyIds)]);
      if (companiesError) throw companiesError;
      (companies || []).forEach((c: any) => { companyMap[c.id] = c.name; });
    }

    const result = (complaints || []).map((c: any) => ({
      ...c,
      company_name: companyMap[c.company_id] || null,
    }));

    return success(result);
  } catch (err) {
    return adminJsonError(err);
  }
}

export async function PATCH(request: NextRequest) {
  try {
    const admin = await requireAdmin(request);
    const parsed = adminComplaintPatchSchema.safeParse(await parseBody(request));
    if (!parsed.success) return error(parsed.error.issues[0]?.message || 'بيانات تحديث الشكوى غير صالحة');

    const { data, error: updateError } = await sb().rpc('admin_update_complaint', {
      p_admin_id: admin.adminId,
      p_complaint_id: parsed.data.id,
      p_status: parsed.data.status ?? null,
      p_reply: parsed.data.adminReply ?? null,
      p_reply_set: parsed.data.adminReply !== undefined,
    });
    if (updateError) throw updateError;
    if ((data as { not_found?: boolean } | null)?.not_found) return error('الشكوى غير موجودة', 404);
    return success(data);
  } catch (err) {
    return adminJsonError(err);
  }
}
