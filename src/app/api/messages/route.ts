import { NextRequest } from 'next/server';
import { success, error, serverError, requireApiAuth, requireModulePermission, handleApiError, parseBody } from '@/lib/api-helpers';
import { getSupabase } from '@/lib/supabase-client';

const sb = () => getSupabase();

export async function GET(request: NextRequest) {
  try {
    const { companyId } = await requireApiAuth(request);
    const { searchParams } = new URL(request.url);
    const page = Math.max(1, parseInt(searchParams.get('page') || '1'));
    const limit = 50;
    const offset = (page - 1) * limit;
    const s = sb();

    const { count } = await s.from('messages')
      .select('*', { count: 'exact', head: true })
      .eq('company_id', companyId);

    const { data: messages } = await s.from('messages')
      .select('id, subject, body, direction, is_read, created_at')
      .eq('company_id', companyId)
      .order('created_at', { ascending: false })
      .range(offset, offset + limit - 1);

    const total = count || 0;
    return success({ messages: messages || [], total, page, pages: Math.ceil(total / limit) });
  } catch (err) {
    if (err instanceof Error && err.message === 'غير مصرح به') return handleApiError(err);
    return serverError(err);
  }
}

export async function POST(request: NextRequest) {
  try {
    const { companyId } = await requireApiAuth(request);
    const body = await parseBody<{ subject: string; body: string }>(request);

    if (!body.subject?.trim()) return error('عنوان الرسالة مطلوب');
    if (!body.body?.trim()) return error('نص الرسالة مطلوب');

    const s = sb();
    const { data: result, error: insertError } = await s.from('messages')
      .insert({
        company_id: companyId,
        subject: body.subject.trim(),
        body: body.body.trim(),
        direction: 'company_to_admin',
      })
      .select('id, created_at')
      .single();

    if (insertError) throw insertError;
    return success({ message: result }, 201);
  } catch (err) {
    if (err instanceof Error && err.message === 'غير مصرح به') return handleApiError(err);
    return serverError(err);
  }
}
