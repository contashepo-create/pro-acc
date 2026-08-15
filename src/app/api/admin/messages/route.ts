import { NextRequest } from 'next/server';
import { getSupabase } from '@/lib/supabase-client';
import { success, error, parseBody } from '@/lib/api-helpers';
import { requireAdmin, adminJsonError } from '@/lib/admin-guard';

const sb = () => getSupabase();
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export async function GET(request: NextRequest) {
  try {
    await requireAdmin(request);
    const { searchParams } = new URL(request.url);
    const companyId = searchParams.get('companyId');

    const s = sb();
    let queryBuilder = s.from('messages')
      .select('id, subject, body, direction, is_read, created_at, company_id, admin_id')
      .order('created_at', { ascending: false })
      .limit(100);

    if (companyId) {
      if (!UUID.test(companyId)) return error('معرّف الشركة غير صالح', 400);
      queryBuilder = queryBuilder.eq('company_id', companyId);
    }

    const { data: messages, error: err } = await queryBuilder;
    if (err) throw err;

    const companyIds = (messages || []).map((m: any) => m.company_id).filter(Boolean);
    const companyMap: Record<string, string> = {};
    if (companyIds.length > 0) {
      const { data: companies, error: companiesError } = await s.from('companies')
        .select('id, name')
        .in('id', [...new Set(companyIds)]);
      if (companiesError) throw companiesError;
      (companies || []).forEach((c: any) => { companyMap[c.id] = c.name; });
    }

    const result = (messages || []).map((m: any) => ({
      ...m,
      company_name: companyMap[m.company_id] || null,
    }));

    return success(result);
  } catch (err) {
    return adminJsonError(err);
  }
}

export async function POST(request: NextRequest) {
  try {
    const admin = await requireAdmin(request);
    const body = await parseBody<{ companyId: string; subject: string; body: string }>(request);

    if (!body.companyId || typeof body.companyId !== 'string') return error('معرف الشركة مطلوب', 400);
    if (!UUID.test(body.companyId)) return error('معرف الشركة غير صالح', 400);
    if (!body.subject?.trim()) return error('عنوان الرسالة مطلوب', 400);
    if (!body.body?.trim()) return error('نص الرسالة مطلوب', 400);
    if (body.subject.length > 200) return error('العنوان طويل جداً', 400);
    if (body.body.length > 5000) return error('نص الرسالة طويل جداً', 400);

    const { data, error: insertErr } = await sb().rpc('admin_send_company_message', {
      p_admin_id: admin.adminId,
      p_company_id: body.companyId,
      p_subject: body.subject.trim(),
      p_body: body.body.trim(),
    });
    if (insertErr) {
      if (/invalid company message/i.test(String(insertErr.message || ''))) return error('الشركة غير موجودة أو بيانات الرسالة غير صالحة', 404);
      throw insertErr;
    }
    return success(data, 201);
  } catch (err) {
    return adminJsonError(err);
  }
}
