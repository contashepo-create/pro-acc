import { NextRequest } from 'next/server';
import { getSupabase } from '@/lib/supabase-client';
import { success, error, parseBody } from '@/lib/api-helpers';
import { requireAdmin, adminJsonError } from '@/lib/admin-guard';

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

    if (companyId) {
      if (!/^[0-9a-fA-F-]{8,}$/.test(companyId)) return error('معرّف الشركة غير صالح', 400);
      queryBuilder = queryBuilder.eq('company_id', companyId);
    }

    const { data: messages, error: err } = await queryBuilder;
    if (err) throw err;

    const companyIds = (messages || []).map((m: any) => m.company_id).filter(Boolean);
    const companyMap: Record<string, string> = {};
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
    return adminJsonError(err);
  }
}

export async function POST(request: NextRequest) {
  try {
    const admin = await requireAdmin(request);
    const body = await parseBody<{ companyId: string; subject: string; body: string }>(request);

    if (!body.companyId || typeof body.companyId !== 'string') return error('معرف الشركة مطلوب', 400);
    if (!/^[0-9a-fA-F-]{8,}$/.test(body.companyId)) return error('معرف الشركة غير صالح', 400);
    if (!body.subject?.trim()) return error('عنوان الرسالة مطلوب', 400);
    if (!body.body?.trim()) return error('نص الرسالة مطلوب', 400);
    if (body.subject.length > 200) return error('العنوان طويل جداً', 400);
    if (body.body.length > 5000) return error('نص الرسالة طويل جداً', 400);

    const s = sb();
    const { data, error: insertErr } = await s.from('messages').insert({
      company_id: body.companyId,
      admin_id: admin.adminId,
      subject: body.subject.trim(),
      body: body.body.trim(),
      direction: 'admin_to_company',
    }).select('id').single();

    if (insertErr) throw insertErr;
    return success({ id: data.id }, 201);
  } catch (err) {
    return adminJsonError(err);
  }
}
