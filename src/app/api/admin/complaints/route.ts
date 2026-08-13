import { NextRequest } from 'next/server';
import { getSupabase } from '@/lib/supabase-client';
import { success, error, parseBody } from '@/lib/api-helpers';
import { requireAdmin, adminJsonError } from '@/lib/admin-guard';

const sb = () => getSupabase();

const ALLOWED_STATUSES = new Set(['pending', 'read', 'replied', 'closed']);

export async function GET(request: NextRequest) {
  try {
    await requireAdmin(request);
    const { searchParams } = new URL(request.url);
    const status = searchParams.get('status') || '';

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
      const { data: companies } = await s.from('companies')
        .select('id, name')
        .in('id', [...new Set(companyIds)]);
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
    const body = await parseBody<{ id: string; status?: string; adminReply?: string }>(request);

    if (!body.id || typeof body.id !== 'string') {
      return error('معرّف الشكوى مطلوب', 400);
    }
    if (body.status && !ALLOWED_STATUSES.has(body.status)) {
      return error('حالة غير صالحة', 400);
    }

    const update: any = {};
    if (body.status) update.status = body.status;
    if (body.adminReply !== undefined) {
      update.admin_reply = String(body.adminReply).slice(0, 5000);
      update.replied_by = admin.adminId;
      update.replied_at = new Date().toISOString();
      if (!update.status) update.status = 'replied';
    }

    if (Object.keys(update).length === 0) return success({ message: 'لا توجد تحديثات' });
    update.updated_at = new Date().toISOString();

    const s = sb();
    const { error: updateErr } = await s.from('complaints').update(update).eq('id', body.id);
    if (updateErr) throw updateErr;

    return success({ ok: true });
  } catch (err) {
    return adminJsonError(err);
  }
}
