import { NextRequest } from 'next/server';
import { success, error, parseBody, requireModulePermission, handleApiError } from '@/lib/api-helpers';
import { getSupabase } from '@/lib/supabase-client';
import { createJournalEntry } from '@/lib/journal-utils';
import {
  loadCustodyFile, assertFileOpen, resolveCustodyAccounts, recordCustodyTx, syncCustodyTotals, round2,
} from '@/lib/custody';

export async function POST(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const auth = await requireModulePermission(request, 'custodies', 'create');
    const { id } = await params;
    const body = await parseBody(request);
    const amount = round2(parseFloat(body.amount));
    const bank_safe_id = body.bank_safe_id;
    const date = body.date || new Date().toISOString().split('T')[0];
    const description = body.description || 'تعزيز عهدة';

    if (!amount || amount <= 0) return error('مبلغ التعزيز يجب أن يكون موجباً');
    if (!bank_safe_id) return error('مصدر الصرف مطلوب');

    const file = await loadCustodyFile(auth.companyId, id);
    if (!file) return error('ملف العهدة غير موجود', 404);
    assertFileOpen(file);

    const s = getSupabase();
    const { data: bank } = await s.from('banks_safes').select('id, account_id').eq('id', bank_safe_id).eq('company_id', auth.companyId).maybeSingle();
    if (!bank?.account_id) return error('الخزينة غير موجودة', 404);
    const acc = await resolveCustodyAccounts(auth.companyId);

    const { journalId, error: jeErr } = await createJournalEntry(auth.companyId, {
      date,
      type: 'general',
      description: `تعزيز ${file.file_number || id}: ${description}`,
      reference_type: 'custody_add',
      reference_id: id,
      created_by: auth.userId,
      lines: [
        { account_id: acc.custodyId, debit: amount, credit: 0, description, project_id: file.project_id },
        { account_id: bank.account_id, debit: 0, credit: amount, description },
      ],
    });
    if (jeErr || !journalId) throw jeErr || new Error('فشل قيد التعزيز');

    await recordCustodyTx(auth.companyId, id, 'addition', amount, description, auth.userId);
    const updated = await syncCustodyTotals(auth.companyId, id);
    return success({ ...updated, journal_entry_id: journalId }, 201);
  } catch (err) {
    return handleApiError(err);
  }
}
