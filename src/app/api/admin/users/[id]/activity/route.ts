import { NextRequest } from 'next/server';
import { getSupabase } from '@/lib/supabase-client';
import { success, error, serverError } from '@/lib/api-helpers';
import { verifyToken } from '@/lib/auth';

// @ts-ignore
const sb = () => getSupabase() as any;

export async function GET(
  request: NextRequest,
  { params: paramsPromise }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await paramsPromise;
    const token = request.cookies.get('admin_token')?.value;
    if (!token) return error('Unauthorized', 401);
    const payload = verifyToken(token);
    if (!payload || payload.role !== 'superadmin') return error('Unauthorized', 401);

    const s = sb();
    const { data, error: err } = await s.from('admin_audit_log')
      .select('id, action, details, created_at')
      .eq('target_type', 'user')
      .eq('target_id', id)
      .order('created_at', { ascending: false })
      .limit(50);

    if (err) throw err;

    return success((data || []).map((row: any) => ({
      action: row.action,
      details: row.details || '',
      timestamp: new Date(row.created_at).toLocaleString('ar-SA'),
    })));
  } catch (err) {
    return serverError(err);
  }
}
