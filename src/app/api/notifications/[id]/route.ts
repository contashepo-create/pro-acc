import { NextRequest } from 'next/server';
import { success, error, parseBody, requireApiAuth, handleApiError } from '@/lib/api-helpers';
import { getSupabase } from '@/lib/supabase-client';

// @ts-ignore
const sb = () => getSupabase() as any;

export async function PUT(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const auth = await requireApiAuth(req);
    const { id } = await params;
    const s = sb();
    const body = await parseBody(req);
    const { data: result, error: updateError } = await s.from('notifications')
      .update({ is_read: body.isRead ?? true }).eq('id', id).eq('company_id', auth.companyId).select('*').maybeSingle();
    if (updateError) throw updateError;
    if (!result) return error('Not found', 404);
    return success(result);
  } catch (err) {
    return handleApiError(err);
  }
}

export async function DELETE(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const auth = await requireApiAuth(req);
    const { id } = await params;
    const s = sb();
    const { data: result } = await s.from('notifications').delete().eq('id', id).eq('company_id', auth.companyId).select('id');
    if (!result || result.length === 0) return error('Not found', 404);
    return success({ deleted: true });
  } catch (err) {
    return handleApiError(err);
  }
}
