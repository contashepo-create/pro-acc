import { NextRequest } from 'next/server';
import { getSupabase } from '@/lib/supabase-client';
import { success, error, parseBody } from '@/lib/api-helpers';
import { requireAdmin, adminJsonError } from '@/lib/admin-guard';

const sb = () => getSupabase();

const ALLOWED_STATUSES = new Set(['pending', 'read', 'replied', 'closed']);
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export async function GET(request: NextRequest) {
  try {
    await requireAdmin(request);
    const { searchParams } = new URL(request.url);
    const status = searchParams.get('status') || '';

    if (status && !ALLOWED_STATUSES.has(status)) return error('حالة غير صالحة');
    const s = sb();
    let queryBuilder = s.from('complaints')
      .select('id, type, subject, body, status, admin_reply, created_at, company_id, replied_at')
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
    const body = await parseBody<{ id?: string; status?: string; adminReply?: string }>(request);
    if (!body.id || !UUID.test(body.id)) return error('معرّف الشكوى غير صالح');
    if (body.status !== undefined && !ALLOWED_STATUSES.has(body.status)) return error('حالة غير صالحة');
    if (body.adminReply !== undefined && (typeof body.adminReply !== 'string' || body.adminReply.length > 5000)) return error('رد الإدارة طويل جداً');
    if (body.status === undefined && body.adminReply === undefined) return error('لا توجد حقول قابلة للتحديث');

    const { data, error: updateError } = await sb().rpc('admin_update_complaint', {
      p_admin_id: admin.adminId,
      p_complaint_id: body.id,
      p_status: body.status ?? null,
      p_reply: body.adminReply ?? null,
      p_reply_set: body.adminReply !== undefined,
    });
    if (updateError) throw updateError;
    if ((data as { not_found?: boolean } | null)?.not_found) return error('الشكوى غير موجودة', 404);
    return success(data);
  } catch (err) {
    return adminJsonError(err);
  }
}
