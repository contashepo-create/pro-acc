import { NextRequest } from 'next/server';
import { success, error, handleApiError, parseBody, enforceRateLimit, requireApiAuth, requireModulePermission } from '@/lib/api-helpers';
import { getSupabase } from '@/lib/supabase-client';
import { extractToken } from '@/lib/auth';
import { communicationUuid, publicComplaintSchema, tenantComplaintSchema } from '@/lib/communication-validation';

import type { Row } from '@/lib/types';

export async function GET(request: NextRequest) {
  try {
    const trackingId = request.nextUrl.searchParams.get('tracking_id');
    if (trackingId) {
      const ip = request.headers.get('x-forwarded-for')?.split(',')[0]?.trim() || 'unknown';
      await enforceRateLimit(request, `complaint-track:${ip}`);
      if (!communicationUuid.safeParse(trackingId).success) return error('لم يتم العثور على الشكوى بموجب هذا المعرّف', 404);
      const { data, error: queryError } = await getSupabase().from('complaints')
        .select('id,type,subject,status,admin_reply,created_at,updated_at').eq('id', trackingId)
        .is('deleted_at', null).maybeSingle();
      if (queryError) throw queryError;
      if (!data) return error('لم يتم العثور على الشكوى بموجب هذا المعرّف', 404);
      return success(data);
    }
    const auth = await requireModulePermission(request, 'complaints', 'read');
    const { data, error: queryError } = await getSupabase().from('complaints')
      .select('id,type,subject,body,status,admin_reply,created_at,updated_at,user_id,users(name)')
      .eq('company_id', auth.companyId).is('deleted_at', null).order('created_at', { ascending: false }).limit(50);
    if (queryError) throw queryError;
    return success({ complaints: ((data ?? []) as Row[]).map((row: Row) => ({ ...row, user_name: row.users ? String((row.users as Row).name) || null : null, users: undefined })) });
  } catch (cause) {
    return handleApiError(cause);
  }
}

export async function POST(request: NextRequest) {
  try {
    const ip = request.headers.get('x-forwarded-for')?.split(',')[0]?.trim() || 'unknown';
    await enforceRateLimit(request, `complaint-create:${ip}`);
    const input = await parseBody(request);
    const token = extractToken(request);
    let companyId: string | null = null;
    let userId: string | null = null;
    let type: 'complaint' | 'suggestion';
    let subject: string;
    let body: string;
    if (token) {
      const auth = await requireApiAuth(request, { checkSubscription: false });
      const parsed = tenantComplaintSchema.safeParse(input);
      if (!parsed.success) return error(parsed.error.issues[0]?.message || 'بيانات الشكوى غير صالحة');
      companyId = auth.companyId; userId = auth.userId;
      ({ type, subject, body } = parsed.data);
    } else {
      const parsed = publicComplaintSchema.safeParse(input);
      if (!parsed.success) return error(parsed.error.issues[0]?.message || 'بيانات الشكوى غير صالحة');
      type = parsed.data.type; subject = parsed.data.subject;
      body = `اسم المرسل: ${parsed.data.name}\nبريد المرسل: ${parsed.data.email}\n\nالرسالة:\n${parsed.data.message}`;
      if (body.length > 5000) return error('نص الشكوى طويل جداً');
    }
    const { data, error: rpcError } = await getSupabase().rpc('create_complaint_atomic', {
      p_company_id: companyId, p_user_id: userId, p_type: type, p_subject: subject, p_body: body,
    });
    if (rpcError) throw rpcError;
    return success(data, 201);
  } catch (cause) {
    return handleApiError(cause);
  }
}
