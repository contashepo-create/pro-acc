import { NextRequest } from 'next/server';
import { success, serverError, requireApiAuth, handleApiError } from '@/lib/api-helpers';
import { query } from '@/lib/db';

export async function PATCH(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { companyId } = await requireApiAuth(request);
    const { id } = await params;

    await query(
      `UPDATE messages SET is_read = true WHERE id = $1 AND company_id = $2`,
      [id, companyId]
    );

    return success({ ok: true });
  } catch (err) {
    if (err instanceof Error && err.message === 'غير مصرح به') return handleApiError(err);
    return serverError(err);
  }
}
