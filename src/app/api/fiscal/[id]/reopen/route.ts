import { NextRequest } from 'next/server';
import { success, error, notFound, requireModulePermission, handleApiError } from '@/lib/api-helpers';
import { getSupabase } from '@/lib/supabase-client';
import { postReversalEntry } from '@/lib/voucher-utils';

const sb = () => getSupabase();

/**
 * Reopen a fiscal year without ever deleting posted closing entries.
 * Reopening is a new accounting event: each closing entry receives an audited
 * reversing entry, preserving the historical ledger and audit trail.
 */
export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const auth = await requireModulePermission(req, 'fiscal', 'approve');
    const { id } = await params;
    const s = sb();

    const { data: fy } = await s.from('fiscal_years')
      .select('*').eq('id', id).eq('company_id', auth.companyId).maybeSingle();
    if (!fy) return notFound();
    if (fy.status !== 'closed') return error('السنة المالية غير مقفلة');

    // Never silently reopen later closed years. Their balances depend on this
    // period and must be explicitly reopened in reverse chronological order.
    const { data: newerClosed, error: newerError } = await s.from('fiscal_years')
      .select('id, name').eq('company_id', auth.companyId).eq('status', 'closed').gt('start_date', fy.start_date).limit(1);
    if (newerError) throw newerError;
    if (newerClosed && newerClosed.length > 0) {
      return error('لا يمكن إعادة فتح السنة قبل إعادة فتح السنوات المالية الأحدث أولاً', 409);
    }

    const { data: closingJes, error: closingError } = await s.from('journal_entries')
      .select('id, number')
      .eq('company_id', auth.companyId)
      .eq('type', 'closing')
      .gte('date', fy.start_date)
      .lte('date', fy.end_date);
    if (closingError) throw closingError;

    // Open first so the reversal writer can post a legitimate correcting
    // event; if a reversal fails, do not pretend the reopen succeeded.
    const { error: openError } = await s.from('fiscal_years')
      .update({ status: 'open', closed_at: null, closed_by: null })
      .eq('id', id).eq('company_id', auth.companyId);
    if (openError) throw openError;

    const reversalIds: string[] = [];
    for (const closing of closingJes || []) {
      const { error: reversalError } = await postReversalEntry(auth.companyId, {
        journalEntryId: closing.id,
        referenceType: 'fiscal_year_reopen',
        referenceId: id,
        description: `عكس قيد الإقفال رقم ${closing.number} عند إعادة فتح السنة ${fy.name || ''}`,
        userId: auth.userId,
      });
      if (reversalError) {
        // The original closing entries remain intact. Surface failure loudly so
        // accounting staff can resolve it instead of losing history.
        throw reversalError;
      }
      reversalIds.push(closing.id);
    }

    return success({ ...fy, status: 'open', reversedClosingEntries: reversalIds.length });
  } catch (err) {
    return handleApiError(err);
  }
}
