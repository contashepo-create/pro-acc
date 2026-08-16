import { NextRequest } from 'next/server';
import { success, error, handleApiError, parseBody, getPaginationParams, requireModulePermission } from '@/lib/api-helpers';
import { getSupabase } from '@/lib/supabase-client';
import { tenderCreateSchema, tenderLifecycleStatus } from '@/lib/relationship-validation';

const sb = () => getSupabase();

export async function GET(request: NextRequest) {
  try {
    const auth = await requireModulePermission(request, 'tenders', 'read');
    const url = new URL(request.url);
    const { page, pageSize } = getPaginationParams(url);
    const status = url.searchParams.get('status');
    if (status && !tenderLifecycleStatus.safeParse(status).success) return error('حالة المناقصة غير صالحة');
    let query = sb().from('tenders').select('*, tenders_contacts(name)', { count: 'exact' })
      .eq('company_id', auth.companyId);
    if (status) query = query.eq('status', status);
    const offset = (page - 1) * pageSize;
    const { data, error: queryError, count } = await query.order('submission_deadline', { ascending: true, nullsFirst: false })
      .range(offset, offset + pageSize - 1);
    if (queryError) throw queryError;
    const now = Date.now();
    const tenders = (data || []).map((tender: Record<string, unknown>) => {
      const contact = tender.tenders_contacts as { name?: string } | null;
      return {
        ...tender,
        contact_name: contact?.name || null,
        daysUntilDeadline: tender.submission_deadline
          ? Math.max(0, Math.ceil((new Date(String(tender.submission_deadline)).getTime() - now) / 86400000)) : null,
        isOverdue: !!tender.submission_deadline && new Date(String(tender.submission_deadline)).getTime() < now,
      };
    });
    const statusCounts = await Promise.all(tenderLifecycleStatus.options.map(async (tenderStatus) => {
      const { count: statusCount, error: countError } = await sb().from('tenders').select('id', { count: 'exact', head: true })
        .eq('company_id', auth.companyId).eq('status', tenderStatus);
      if (countError) throw countError;
      return [tenderStatus, statusCount || 0] as const;
    }));
    const stats = { total: count || 0, ...Object.fromEntries(statusCounts) };
    return success({ tenders, total: count || 0, page, pageSize, stats });
  } catch (err) {
    return handleApiError(err);
  }
}

export async function POST(request: NextRequest) {
  try {
    const auth = await requireModulePermission(request, 'tenders', 'create');
    const parsed = tenderCreateSchema.safeParse(await parseBody(request));
    if (!parsed.success) return error(parsed.error.issues[0].message);
    const { data, error: createError } = await sb().rpc('create_tender_atomic', {
      p_company_id: auth.companyId,
      p_payload: parsed.data,
      p_user_id: auth.userId,
    });
    if (createError) {
      const message = String(createError.message || '');
      if (message.includes('غير صالحة')) return error(message);
      throw createError;
    }
    return success(data, 201);
  } catch (err) {
    return handleApiError(err);
  }
}
