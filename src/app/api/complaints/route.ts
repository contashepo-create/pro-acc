import { NextRequest } from 'next/server';
import { success, error, serverError, requireApiAuth, handleApiError, parseBody } from '@/lib/api-helpers';
import { getSupabase } from '@/lib/supabase-client';

// @ts-ignore
const sb = () => getSupabase() as any;

export async function GET(request: NextRequest) {
  try {
    const { companyId } = await requireApiAuth(request);
    const s = sb();

    const { data: complaints } = await s.from('complaints')
      .select('id, type, subject, body, status, admin_reply, created_at, updated_at')
      .eq('company_id', companyId)
      .order('created_at', { ascending: false })
      .limit(50);

    return success(complaints || []);
  } catch (err) {
    if (err instanceof Error && err.message === 'غير مصرح به') return handleApiError(err);
    return serverError(err);
  }
}

export async function POST(request: NextRequest) {
  try {
    const { companyId, userId } = await requireApiAuth(request);
    const body = await parseBody<{ type: string; subject: string; body: string }>(request);

    if (!['complaint', 'suggestion'].includes(body.type)) return error('نوع غير صالح');
    if (!body.subject?.trim()) return error('العنوان مطلوب');
    if (!body.body?.trim()) return error('النص مطلوب');

    const s = sb();
    const { data: result, error: insertError } = await s.from('complaints')
      .insert({
        company_id: companyId,
        user_id: userId,
        type: body.type,
        subject: body.subject.trim(),
        body: body.body.trim(),
      })
      .select('id, created_at')
      .single();

    if (insertError) throw insertError;
    return success(result, 201);
  } catch (err) {
    if (err instanceof Error && err.message === 'غير مصرح به') return handleApiError(err);
    return serverError(err);
  }
}
