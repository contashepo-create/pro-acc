import { requireAdmin, adminJsonError } from '@/lib/admin-guard';
import { NextRequest } from 'next/server';
import { getSupabase } from '@/lib/supabase-client';
import { success, error } from '@/lib/api-helpers';

import type { Row } from '@/lib/types';

const sb = () => getSupabase();
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export async function GET(
  request: NextRequest,
  { params: paramsPromise }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await paramsPromise;
    await requireAdmin(request);
    if (!UUID.test(id)) return error('معرّف المستخدم غير صالح', 400);

    const s = sb();
    const { data, error: err } = await s.from('admin_audit_log')
      .select('id, action, details, created_at')
      .eq('target_type', 'user')
      .eq('target_id', id)
      .order('created_at', { ascending: false })
      .limit(50);

    if (err) throw err;

    return success((data || []).map((row: Row) => ({
      action: row.action,
      details: row.details || '',
      timestamp: new Date(String(row.created_at)).toLocaleString('ar-SA'),
    })));
  } catch (err) {
    return adminJsonError(err);
  }
}
