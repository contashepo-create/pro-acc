import { NextRequest } from 'next/server';
import { getSupabase } from '@/lib/supabase-client';
import { success, error, parseBody } from '@/lib/api-helpers';
import { requireAdmin, adminJsonError } from '@/lib/admin-guard';
import { adminCompanyMessageSchema, communicationUuid } from '@/lib/communication-validation';

const sb = () => getSupabase();

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

    queryBuilder = queryBuilder.is('deleted_at', null);
    if (companyId) {
      if (!communicationUuid.safeParse(companyId).success) return error('معرّف الشركة غير صالح', 400);
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
    const parsed = adminCompanyMessageSchema.safeParse(await parseBody(request));
    if (!parsed.success) return error(parsed.error.issues[0]?.message || 'بيانات الرسالة غير صالحة', 400);

    const { data, error: insertErr } = await sb().rpc('admin_send_company_message', {
      p_admin_id: admin.adminId,
      p_company_id: parsed.data.companyId,
      p_subject: parsed.data.subject,
      p_body: parsed.data.body,
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
