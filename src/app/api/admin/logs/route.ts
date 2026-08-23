import { NextRequest } from 'next/server';
import { success, error, parseBody } from '@/lib/api-helpers';
import { requireAdmin, adminJsonError } from '@/lib/admin-guard';
import { getSupabase } from '@/lib/supabase-client';

import type { SupabaseQuery, Row } from '@/lib/types';

const sb = () => getSupabase();

function applySearch(query: SupabaseQuery, search: string) {
  if (!search) return query;
  const cleaned = search.replace(/[(),".:;%]/g, ' ').trim().slice(0, 80);
  if (!cleaned) return query;
  return query.or(`action.ilike.%${cleaned}%,details.ilike.%${cleaned}%`);
}

export async function GET(request: NextRequest) {
  try {
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
    const dateOnly = /^\d{4}-\d{2}-\d{2}$/;
    if ((from && (!dateOnly.test(from) || Number.isNaN(Date.parse(from)))) ||
        (to && (!dateOnly.test(to) || Number.isNaN(Date.parse(to))))) return error('نطاق التاريخ غير صالح');
    if (from && to && from > to) return error('بداية النطاق بعد نهايته');
    if (action.length > 100) return error('نوع العملية طويل جداً');

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
      logs: (logs || []).map((row: Row) => ({
        id: row.id,
        timestamp: new Date(String(row.created_at)).toLocaleString('ar-SA'),
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

    // Audit evidence is append-only. Destructive clearing would let an
    // administrator erase the evidence of prior entitlement and tenant
    // changes. Retention/archival must be an audited infrastructure policy,
    // never an interactive API operation.
    await auditLog(__admin.adminId, 'clear_logs_blocked', 'Blocked attempt to delete append-only admin audit evidence');
    return error('سجلات التدقيق غير قابلة للحذف من واجهة التطبيق', 403);
  } catch (err) {
    return adminJsonError(err);
  }
}
