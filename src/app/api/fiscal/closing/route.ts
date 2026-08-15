import { NextRequest } from 'next/server';
import { error, handleApiError, requireModulePermission } from '@/lib/api-helpers';

/**
 * Deprecated ambiguous closing endpoint.
 *
 * Closing must be performed through /api/fiscal/:id/close, which binds the
 * operation to one tenant-scoped fiscal year and produces one balanced closing
 * entry. Keeping the historic fiscalYearId/closingDate endpoint active would
 * allow two inconsistent closing algorithms to coexist.
 */
export async function POST(request: NextRequest) {
  try {
    await requireModulePermission(request, 'fiscal', 'approve');
    return error('مسار الإقفال القديم متوقف. استخدم مسار إقفال السنة المالية المحددة.', 410);
  } catch (err) {
    return handleApiError(err);
  }
}
