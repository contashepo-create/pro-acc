import { NextRequest } from 'next/server';
import { getSupabase } from '@/lib/supabase-client';
import { success, error, serverError, requireAdminAuth, handleApiError, parseBody } from '@/lib/api-helpers';

// @ts-ignore
const sb = () => getSupabase() as any;

export async function GET(request: NextRequest) {
  try {
    await requireAdminAuth(request);
    const { searchParams } = new URL(request.url);
    const companyId = searchParams.get('companyId');

    const s = sb();
    let queryBuilder = s.from('messages')
      .select('id, subject, body, direction, is_read, created_at, company_id')
      .order('created_at', { ascending: false })
      .limit(100);

    if (companyId) {
      queryBuilder = queryBuilder.eq('company_id', companyId);
    }

    const { data: messages, error: err } = await queryBuilder;
    if (err) throw err;

    // Get company names
    const companyIds = (messages || []).map((m: any) => m.company_id).filter(Boolean);
    let companyMap: Record<string, string> = {};
    if (companyIds.length > 0) {
      const { data: companies } = await s.from('companies')
        .select('id, name')
        .in('id', [...new Set(companyIds)]);
      (companies || []).forEach((c: any) => { companyMap[c.id] = c.name; });
    }

    const result = (messages || []).map((m: any) => ({
      ...m,
      company_name: companyMap[m.company_id] || null,
    }));

    return success(result);
  } catch (err) {
    if (err instanceof Error && err.message === 'غير مصرح به') return handleApiError(err);
    return serverError(err);
  }
}

export async function POST(request: NextRequest) {
  try {
    const admin = await requireAdminAuth(request);
    const body = await parseBody<{ companyId: string; subject: string; body: string }>(request);

    if (!body.companyId) return error('معرف الشركة مطلوب');
    if (!body.subject?.trim()) return error('عنوان الرسالة مطلوب');
    if (!body.body?.trim()) return error('نص الرسالة مطلوب');

    const s = sb();
    const { data, error: insertErr } = await s.from('messages').insert({
      company_id: body.companyId,
      admin_id: admin.userId,
      subject: body.subject.trim(),
      body: body.body.trim(),
      direction: 'admin_to_company',
    }).select('id').single();

    if (insertErr) throw insertErr;

    return success({ id: data.id }, 201);
  } catch (err) {
    if (err instanceof Error && err.message === 'غير مصرح به') return handleApiError(err);
    return serverError(err);
  }
}
