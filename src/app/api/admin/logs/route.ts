import { NextRequest } from 'next/server';
import { getSupabase } from '@/lib/supabase-client';
import { success, error, serverError, parseBody, getPaginationParams, getDateRangeParams } from '@/lib/api-helpers';
import { verifyToken } from '@/lib/auth';
import { verifyMasterPassword, auditLog } from '@/lib/admin-auth';

const sb = () => getSupabase();

export async function GET(request: NextRequest) {
  try {
    const token = request.cookies.get('admin_token')?.value;
    if (!token) return error('Unauthorized', 401);
    const payload = verifyToken(token);
    if (!payload || payload.role !== 'superadmin') return error('Unauthorized', 401);

    const { page, pageSize } = getPaginationParams(request.url);
    const { from, to } = getDateRangeParams(request.url);
    const search = request.nextUrl.searchParams.get('search') || '';
    const action = request.nextUrl.searchParams.get('action') || '';

    const s = sb();

    let countBuilder = s.from('admin_audit_log').select('*', { count: 'exact', head: true });

    if (search) {
      countBuilder = countBuilder.or(`action.ilike.%${search}%,details.ilike.%${search}%`);
    }
    if (action) {
      countBuilder = countBuilder.eq('action', action);
    }
    if (from) {
      countBuilder = countBuilder.gte('created_at', from);
    }
    if (to) {
      const toDate = new Date(to + 'T23:59:59');
      countBuilder = countBuilder.lte('created_at', toDate.toISOString());
    }

    const { count: total, error: countErr } = await countBuilder;
    if (countErr) throw countErr;

    let dataBuilder = s.from('admin_audit_log')
      .select('id, action, details, ip_address, target_type, target_id, created_at')
      .order('created_at', { ascending: false })
      .range((page - 1) * pageSize, page * pageSize - 1);

    if (search) {
      dataBuilder = dataBuilder.or(`action.ilike.%${search}%,details.ilike.%${search}%`);
    }
    if (action) {
      dataBuilder = dataBuilder.eq('action', action);
    }
    if (from) {
      dataBuilder = dataBuilder.gte('created_at', from);
    }
    if (to) {
      const toDate = new Date(to + 'T23:59:59');
      dataBuilder = dataBuilder.lte('created_at', toDate.toISOString());
    }

    const { data: logs, error: dataErr } = await dataBuilder;
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
    return serverError(err);
  }
}

export async function DELETE(request: NextRequest) {
  try {
    const token = request.cookies.get('admin_token')?.value;
    if (!token) return error('Unauthorized', 401);
    const payload = verifyToken(token);
    if (!payload || payload.role !== 'superadmin') return error('Unauthorized', 401);

    const body = await parseBody<{ masterPassword: string }>(request);
    if (!body.masterPassword) {
      return error('كلمة السر الرئيسية مطلوبة', 401);
    }

    const valid = await verifyMasterPassword(payload.userId, body.masterPassword);
    if (!valid) {
      return error('كلمة السر الرئيسية غير صحيحة', 401);
    }

    const s = sb();
    const { error: deleteErr } = await s.from('admin_audit_log').delete().neq('id', '00000000-0000-0000-0000-000000000000');
    if (deleteErr) throw deleteErr;

    await auditLog(payload.userId, 'clear_logs', 'Cleared all audit logs');

    return success({ message: 'تم مسح سجل الأحداث بنجاح' });
  } catch (err) {
    return serverError(err);
  }
}
