import { NextRequest } from 'next/server';
import { success, error, handleApiError, requireModulePermission, parseBody } from '@/lib/api-helpers';
import { getSupabase } from '@/lib/supabase-client';

const sb = () => getSupabase();

/** Create one immutable reversing entry and link it to its source atomically. */
export async function POST(request: NextRequest) {
  try {
    const auth = await requireModulePermission(request, 'fiscal', 'approve');
    const { originalEntryId, reverseDate, description } = await parseBody<{
      originalEntryId?: string;
      reverseDate?: string;
      description?: string;
    }>(request);
    if (!originalEntryId || typeof originalEntryId !== 'string') return error('originalEntryId مطلوب');
    const date = reverseDate || new Date().toISOString().slice(0, 10);
    if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) return error('تاريخ القيد العكسي غير صالح');
    if (description !== undefined && (typeof description !== 'string' || !description.trim() || description.length > 2000)) {
      return error('وصف القيد العكسي غير صالح');
    }

    const { data: result, error: rpcError } = await sb().rpc('reverse_journal_entry_atomic', {
      p_company_id: auth.companyId,
      p_journal_entry_id: originalEntryId,
      p_reverse_date: date,
      p_description: description?.trim() || `قيد عكسي للقيد ${originalEntryId}`,
      p_reference_type: 'journal_entry_reversal',
      p_reference_id: originalEntryId,
      p_user_id: auth.userId,
    });
    if (rpcError) {
      const message = String(rpcError.message || '');
      if (message.includes('القيد الأصلي غير موجود')) return error(message, 404);
      if (message.includes('closed fiscal year')) return error('لا يمكن الترحيل في سنة مالية مقفلة', 409);
      throw rpcError;
    }
    return success(result, 201);
  } catch (err) {
    return handleApiError(err);
  }
}
