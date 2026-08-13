import { requireAdmin, adminJsonError } from '@/lib/admin-guard';
import { NextRequest } from 'next/server';
import { getSupabase } from '@/lib/supabase-client';
import { success, error, parseBody } from '@/lib/api-helpers';

const sb = () => getSupabase();

export async function GET(req: NextRequest) {
  try {
    await requireAdmin(req);
    const s = sb();
    const status = req.nextUrl.searchParams.get('status') || 'open';
    let query = s.from('support_tickets').select(`
      id, subject, message, category, status, attachment_url,
      admin_notes, created_at, updated_at,
      companies(id, name, email, phone),
      users(id, name, email)
    `).order('created_at', { ascending: false }).limit(200);
    if (status !== 'all') query = query.eq('status', status);
    const { data, error: err } = await query;
    if (err) throw err;
    return success({ tickets: data || [] });
  } catch (e) {
    return adminJsonError(e);
  }
}

export async function PUT(req: NextRequest) {
  try {
    await requireAdmin(req);
    const s = sb();
    const body = await parseBody<{ id?: string; status?: string; admin_notes?: string }>(req);
    if (!body.id) return error('id مطلوب');
    const validStatus = ['open','in_progress','resolved','closed'];
    if (body.status && !validStatus.includes(body.status)) return error('حالة غير صالحة');

    // Authorize: verify the ticket exists and fetch company for notification
    const { data: existing, error: fErr } = await s.from('support_tickets')
      .select('id, company_id, subject, status').eq('id', body.id).maybeSingle();
    if (fErr || !existing) return error('التذكرة غير موجودة', 404);

    const patch: Record<string, any> = { updated_at: new Date().toISOString() };
    if (body.status) patch.status = body.status;
    if (body.admin_notes !== undefined) patch.admin_notes = body.admin_notes;

    const { data, error: err } = await s.from('support_tickets')
      .update(patch).eq('id', body.id).select('id, status').single();
    if (err) throw err;

    // Notify the customer when their ticket is resolved/closed or replied to
    try {
      const notifyStatuses = new Set(['resolved', 'closed', 'in_progress']);
      if (body.status && notifyStatuses.has(body.status)) {
        const stLabels: Record<string, string> = {
          open: 'مفتوحة', in_progress: 'قيد المعالجة', resolved: 'تم الحل', closed: 'مغلقة',
        };
        await s.from('company_messages').insert({
          company_id: (existing as any).company_id,
          subject: `تحديث للتذكرة: ${(existing as any).subject}`,
          body: `تم تحديث حالة تذكرة الدعم الخاصة بك إلى: ${stLabels[body.status] || body.status}.${body.admin_notes ? '\nرد الإدارة: ' + String(body.admin_notes).slice(0, 2000) : ''}`,
          type: 'support_update',
          status: 'open',
        });
      }
    } catch {}

    return success({ ticket: data });
  } catch (e) {
    return adminJsonError(e);
  }
}
