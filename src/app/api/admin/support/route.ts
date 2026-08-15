import { requireAdmin, adminJsonError } from '@/lib/admin-guard';
import { NextRequest } from 'next/server';
import { getSupabase } from '@/lib/supabase-client';
import { success, error, parseBody } from '@/lib/api-helpers';

const VALID_STATUS = new Set(['open','in_progress','resolved','closed']);
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export async function GET(req: NextRequest) {
  try {
    await requireAdmin(req);
    const status = req.nextUrl.searchParams.get('status') || 'open';
    if (status !== 'all' && !VALID_STATUS.has(status)) return error('حالة غير صالحة');
    let query = getSupabase().from('support_tickets').select(`
      id, subject, message, category, status, attachment_url,
      admin_notes, created_at, updated_at,
      companies(id, name, email, phone),
      users(id, name, email)
    `).order('created_at', { ascending: false }).limit(200);
    if (status !== 'all') query = query.eq('status', status);
    const { data, error: queryError } = await query;
    if (queryError) throw queryError;
    return success({ tickets: data || [] });
  } catch (err) {
    return adminJsonError(err);
  }
}

export async function PUT(req: NextRequest) {
  try {
    const admin = await requireAdmin(req);
    const input = await parseBody<Record<string, unknown>>(req);
    const id = typeof input.id === 'string' ? input.id : '';
    if (!UUID.test(id)) return error('id غير صالح');
    if (input.status !== undefined && (typeof input.status !== 'string' || !VALID_STATUS.has(input.status))) return error('حالة غير صالحة');
    if (input.admin_notes !== undefined && (typeof input.admin_notes !== 'string' || input.admin_notes.length > 2000)) return error('رد الإدارة طويل جداً');
    if (input.status === undefined && input.admin_notes === undefined) return error('لا توجد حقول قابلة للتحديث');

    const { data, error: updateError } = await getSupabase().rpc('admin_update_support_ticket', {
      p_admin_id: admin.adminId,
      p_ticket_id: id,
      p_status: input.status ?? null,
      p_admin_notes: input.admin_notes ?? null,
      p_notes_set: input.admin_notes !== undefined,
    });
    if (updateError) throw updateError;
    if ((data as any)?.not_found) return error('التذكرة غير موجودة', 404);
    return success({ ticket: data });
  } catch (err) {
    return adminJsonError(err);
  }
}
