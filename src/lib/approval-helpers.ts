/** Approval helpers. All financial decisions and postings execute in PostgreSQL RPCs. */
import { getSupabase } from '@/lib/supabase-client';
import { requireApproval } from '@/lib/notifications';

const sb = () => getSupabase();

export async function checkTransactionBeforeSave(
  companyId: string, userId: string, amount: number, transactionType: string,
  transactionId: string, description?: string,
): Promise<{ blocked: boolean; message?: string; requiresApproval: boolean }> {
  const result = await requireApproval(companyId, amount, transactionType, userId, transactionId, description);
  return { blocked: result.blocked, message: result.message, requiresApproval: result.requiresApproval };
}

/**
 * Kept only as an explicit fail-closed compatibility boundary. Posting an
 * approval through application-side reads/writes can partially commit and is
 * forbidden; voucher and generic approval RPCs perform the full transaction.
 */
export async function createJournalEntryForApprovedTransaction(): Promise<never> {
  throw new Error('Application-side approval posting is disabled; use the atomic approval RPC');
}

export async function getTransactionApprovalStatus(
  companyId: string, transactionType: string, transactionId: string,
): Promise<{ status: string; approvalId?: string | null }> {
  const { data: approval, error: approvalError } = await sb().from('approval_requests')
    .select('id,status').eq('company_id', companyId).eq('transaction_type', transactionType)
    .eq('transaction_id', transactionId).order('created_at', { ascending: false }).limit(1).maybeSingle();
  if (approvalError) throw approvalError;
  if (approval) return { status: approval.status, approvalId: approval.id };
  const tableMap: Record<string, string> = {
    voucher_disbursement: 'voucher_disbursements', voucher_receipt: 'voucher_receipts',
    cash_transaction: 'cash_transactions', journal_entry: 'journal_entries',
  };
  const table = tableMap[transactionType];
  if (!table) return { status: 'not_required', approvalId: null };
  const { data, error } = await sb().from(table).select('status').eq('id', transactionId)
    .eq('company_id', companyId).maybeSingle();
  if (error) throw error;
  return { status: data?.status || 'not_found', approvalId: null };
}
