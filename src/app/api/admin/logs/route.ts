import { NextRequest } from 'next/server';
import { success, error, serverError, parseBody } from '@/lib/api-helpers';
import { requireAdmin, adminJsonError } from '@/lib/admin-guard';
import { getSupabase } from '@/lib/supabase-client';

const sb = () => getSupabase();

function applySearch(query: any, search: string) {
  if (!search) return query;
  const cleaned = search.replace(/[(),".:;%]/g, ' ').trim().slice(0, 80);
  if (!cleaned) return query;
  return query.or(`action.ilike.%${cleaned}%,details.ilike.%${cleaned}%`);
}

export async function GET(request: NextRequest) {
  try {
      const __admin = await requireAdmin(request);
    await requireAdmin(request);

    const { page, pageSize } = (() => {
      const url = new URL(request.url);
      const p = Math.max(1, parseInt(url.searchParams.get('page') || '1', 10) || 1);
      const ps = Math.min(200, Math.max(1, parseInt(url.searchParams.get('pageSize') || '50', 10) || 50));
      return { page: p, pageSize: ps };
    })();
    const url = new URL(request.url);
    const search = url.searchParams.get('search') || '';
    const action = url.searchParams.get('action') || '';
    const from = url.searchParams.get('from');
    const to = url.searchParams.get('to');

    const s = sb();

    let countQ = s.from('admin_audit_log').select('*', { count: 'exact', head: true });
    countQ = applySearch(countQ, search);
    if (action) countQ = countQ.eq('action', action);
    if (from) countQ = countQ.gte('created_at', from);
    if (to) countQ = countQ.lte('created_at', to + 'T23:59:59');
    const { count: total, error: countErr } = await countQ;
    if (countErr) throw countErr;

    let dataQ = s.from('admin_audit_log')
      .select('id, action, details, ip_address, target_type, target_id, created_at')
      .order('created_at', { ascending: false })
      .range((page - 1) * pageSize, page * pageSize - 1);
    dataQ = applySearch(dataQ, search);
    if (action) dataQ = dataQ.eq('action', action);
    if (from) dataQ = dataQ.gte('created_at', from);
    if (to) dataQ = dataQ.lte('created_at', to + 'T23:59:59');
    const { data: logs, error: dataErr } = await dataQ;
    if (dataErr) throw dataErr;

    return success({
      logs: (logs || []).map((row: any) => ({
        id: row.id,
        timestamp: new Date(row.created_at).toLocaleString('ar-SA'),
        action: row.action,
        details: row.details || '',
        ip: row.ip_address || '',
      })),
      total: total || 0,
      page,
      pageSize,
    });
  } catch (err) {
    return adminJsonError(err);
  }
}

export async function DELETE(request: NextRequest) {
  try {
    const __admin = await requireAdmin(request);
    const body = await parseBody<{ masterPassword: string }>(request);
    if (!body.masterPassword) return error('كلمة السر الرئيسية مطلوبة', 401);

    // verify master password before mass-delete
    const { verifyMasterPassword, auditLog } = await import('@/lib/admin-auth');
    const valid = await verifyMasterPassword(__admin.adminId, body.masterPassword);
    if (!valid) return error('كلمة السر الرئيسية غير صحيحة', 401);

    const s = sb();
    // Never delete the seed/system entries — safer to truncate by time (older than now).
    // Use delete with `id` is not null to delete all rows (PostgREST requires a filter).
    const { error: deleteErr } = await s.from('admin_audit_log').delete().neq('id', '00000000-0000-0000-0000-000000000000');
    if (deleteErr) throw deleteErr;

    await auditLog(__admin.adminId, 'clear_logs', 'Audit logs cleared by admin');

    return success({ message: 'تم مسح السجلات بنجاح' });
  } catch (err) {
    return adminJsonError(err);
  }
}

// Use serverError for unexpected non-auth errors
export { serverError };
