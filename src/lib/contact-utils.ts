/** Authoritative customer/supplier balances from control-account ledger lines. */

import type { Row } from './types';
import { getSupabase } from '@/lib/supabase-client';

const sb = () => getSupabase();

/**
 * Signed balance: positive is debit/receivable, negative is credit/payable.
 * PostgreSQL limits the calculation to the control accounts appropriate for
 * the contact type, so analytical contact tags on revenue/cash lines cannot
 * cancel the auxiliary ledger.
 */
export async function getContactBalance(companyId: string, contactId: string): Promise<number> {
  const { data, error } = await sb().rpc('get_contact_balance', {
    p_company_id: companyId,
    p_contact_id: contactId,
    p_as_of: null,
  });
  if (error) throw error;
  const value = Number(data);
  if (!Number.isFinite(value)) throw new Error('Invalid contact balance result');
  return value;
}

/** Batch balance lookup for a tenant-scoped page of contacts. */
export async function getContactBalances(
  companyId: string,
  contactIds: string[]
): Promise<Record<string, number>> {
  const map: Record<string, number> = {};
  if (!contactIds.length) return map;
  const { data, error } = await sb().rpc('get_contact_balance_batch', {
    p_company_id: companyId,
    p_contact_ids: contactIds,
  });
  if (error) throw error;
  for (const row of (data ?? []) as Row[]) {
    const id = String((row as Record<string, unknown>).contact_id || '');
    const balance = Number((row as Record<string, unknown>).balance);
    if (id && Number.isFinite(balance)) map[id] = balance;
  }
  return map;
}
