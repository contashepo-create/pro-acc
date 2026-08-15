/** Create a tenant-scoped child account and, optionally, a balanced opening entry. */
import { getSupabase } from '@/lib/supabase-client';
import { createJournalEntry } from '@/lib/journal-utils';

interface CreateAccountParams {
  companyId: string;
  code: string;
  name: string;
  nameEn?: string;
  type: 'asset' | 'liability' | 'equity' | 'revenue' | 'expense';
  parentCode: string;
  openingBalance?: number;
  createdBy?: string;
}

export async function createAutoAccount(params: CreateAccountParams): Promise<{
  id: string; code: string; name: string; journalId?: string;
} | null> {
  const s = getSupabase();
  try {
    const opening = Number(params.openingBalance || 0);
    if (!Number.isFinite(opening) || Math.abs(opening * 100 - Math.round(opening * 100)) > 1e-8) return null;
    const { data: parentAccount, error: parentError } = await s.from('accounts')
      .select('id').eq('company_id', params.companyId).eq('code', params.parentCode).maybeSingle();
    if (parentError || !parentAccount) return null;

    const { data: newAccount, error: accountError } = await s.from('accounts').insert({
      company_id: params.companyId, code: params.code, name: params.name,
      name_en: params.nameEn || null, type: params.type,
      parent_id: parentAccount.id, is_active: true,
    }).select('id, code, name').single();
    if (accountError || !newAccount) return null;
    if (!opening) return newAccount;
    if (!params.createdBy) {
      await s.from('accounts').delete().eq('id', newAccount.id).eq('company_id', params.companyId);
      return null;
    }

    const { data: capitalAccount } = await s.from('accounts').select('id')
      .eq('company_id', params.companyId).eq('code', '3100').maybeSingle();
    if (!capitalAccount) {
      await s.from('accounts').delete().eq('id', newAccount.id).eq('company_id', params.companyId);
      return null;
    }
    const positive = Math.abs(opening);
    const entry = await createJournalEntry(params.companyId, {
      date: new Date().toISOString().slice(0, 10), type: 'opening_balance',
      description: `رصيد افتتاحي - ${params.name}`,
      lines: opening > 0 ? [
        { account_id: newAccount.id, debit: positive, credit: 0 },
        { account_id: capitalAccount.id, debit: 0, credit: positive },
      ] : [
        { account_id: newAccount.id, debit: 0, credit: positive },
        { account_id: capitalAccount.id, debit: positive, credit: 0 },
      ],
      reference_type: 'account_opening_balance', reference_id: newAccount.id,
      created_by: params.createdBy,
    });
    if (entry.error || !entry.journalId) {
      await s.from('accounts').delete().eq('id', newAccount.id).eq('company_id', params.companyId);
      return null;
    }
    return { ...newAccount, journalId: entry.journalId };
  } catch {
    return null;
  }
}
