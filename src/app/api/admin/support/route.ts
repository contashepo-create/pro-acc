import { requireAdmin, adminJsonError } from '@/lib/admin-guard';
import { NextRequest } from 'next/server';
import { getSupabase } from '@/lib/supabase-client';
import { success, error, parseBody } from '@/lib/api-helpers';
import { adminSupportPatchSchema } from '@/lib/communication-validation';

const VALID_STATUS = new Set(['open','in_progress','resolved','closed']);

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
    const parsed = adminSupportPatchSchema.safeParse(await parseBody(req));
    if (!parsed.success) return error(parsed.error.issues[0]?.message || 'بيانات تحديث التذكرة غير صالحة');

    const { data, error: updateError } = await getSupabase().rpc('admin_update_support_ticket', {
      p_admin_id: admin.adminId,
      p_ticket_id: parsed.data.id,
      p_status: parsed.data.status ?? null,
      p_admin_notes: parsed.data.admin_notes ?? null,
      p_notes_set: parsed.data.admin_notes !== undefined,
    });
    if (updateError) throw updateError;
    if ((data as any)?.not_found) return error('التذكرة غير موجودة', 404);
    return success({ ticket: data });
  } catch (err) {
    return adminJsonError(err);
  }
}
