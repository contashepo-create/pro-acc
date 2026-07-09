import { NextRequest } from 'next/server';
import { getSupabase } from '@/lib/supabase-client';
import { success, serverError, requireAdminAuth, handleApiError, parseBody } from '@/lib/api-helpers';

// @ts-ignore
const sb = () => getSupabase() as any;

export async function GET(request: NextRequest) {
  try {
    await requireAdminAuth(request);
    const { searchParams } = new URL(request.url);
    const status = searchParams.get('status') || '';

    const s = sb();

    // Get complaints
    let queryBuilder = s.from('complaints')
      .select('id, type, subject, body, status, admin_reply, created_at, company_id')
      .order('created_at', { ascending: false })
      .limit(100);

    if (status && ['pending', 'read', 'replied', 'closed'].includes(status)) {
      queryBuilder = queryBuilder.eq('status', status);
    }

    const { data: complaints, error: err } = await queryBuilder;
    if (err) throw err;

    // Get company names
    const companyIds = (complaints || []).map((c: any) => c.company_id).filter(Boolean);
    let companyMap: Record<string, string> = {};
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
    if (err instanceof Error && err.message === 'غير مصرح به') return handleApiError(err);
    return serverError(err);
  }
}

export async function PATCH(request: NextRequest) {
  try {
    const admin = await requireAdminAuth(request);
    const body = await parseBody<{ id: string; status?: string; adminReply?: string }>(request);

    if (body.status && !['pending', 'read', 'replied', 'closed'].includes(body.status)) {
      return success({ message: 'حالة غير صالحة' }, 400);
    }

    const update: any = {};

    if (body.status) {
      update.status = body.status;
    }

    if (body.adminReply !== undefined) {
      update.admin_reply = body.adminReply;
      update.replied_by = admin.userId;
      update.replied_at = new Date().toISOString();
    }

    if (Object.keys(update).length === 0) return success({ message: 'لا توجد تحديثات' });

    update.updated_at = new Date().toISOString();

    const s = sb();
    const { error: updateErr } = await s.from('complaints').update(update).eq('id', body.id);
    if (updateErr) throw updateErr;

    return success({ ok: true });
  } catch (err) {
    if (err instanceof Error && err.message === 'غير مصرح به') return handleApiError(err);
    return serverError(err);
  }
}
