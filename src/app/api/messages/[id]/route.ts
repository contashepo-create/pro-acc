import { NextRequest } from 'next/server';
import { success, serverError, requireApiAuth, handleApiError } from '@/lib/api-helpers';
import { getSupabase } from '@/lib/supabase-client';

const sb = () => getSupabase();

export async function PATCH(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { companyId } = await requireApiAuth(request);
    const { id } = await params;
    const s = sb();

    await s.from('messages')
      .update({ is_read: true })
      .eq('id', id)
      .eq('company_id', companyId);

    return success({ ok: true });
  } catch (err) {
    if (err instanceof Error && err.message === 'غير مصرح به') return handleApiError(err);
    return serverError(err);
  }
}
