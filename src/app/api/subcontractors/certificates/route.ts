import { NextRequest } from 'next/server';
import { success, error, parseBody, getPaginationParams, requireApiAuth, handleApiError, requireModulePermission } from '@/lib/api-helpers';
import { getSupabase } from '@/lib/supabase-client';
import { ACCOUNT_CODES } from '@/lib/constants';

const sb = () => getSupabase();

export async function GET(req: NextRequest) {
  try {
    const auth = await requireModulePermission(req, 'subcontractors', 'read');
    const url = new URL(req.url);
    const { page, pageSize } = getPaginationParams(url);
    const contractId = url.searchParams.get('contractId');
    const s = sb();

    let query = s.from('subcontractor_certificates')
      .select('*, subcontractor_contracts!contract_id(contract_number), contacts!subcontractor_contracts(subcontractor_id)!inner(name)', { count: 'exact' })
      .eq('company_id', auth.companyId);

    if (contractId) {
      query = query.eq('contract_id', contractId);
    }

    const offset = (page - 1) * pageSize;
    const { data: certs, count, error: queryError } = await query
      .order('date', { ascending: false })
      .range(offset, offset + pageSize - 1);

    if (queryError) throw queryError;

    return success({
      certificates: (certs || []).map((c: any) => ({
        ...c,
        contract_number: c.subcontractor_contracts?.contract_number || null,
        subcontractor_name: c.subcontractor_contracts?.contacts?.name || null,
      })),
      total: count || 0,
      page,
      pageSize,
    });
  } catch (err) {
    return handleApiError(err);
  }
}

export async function POST(req: NextRequest) {
  try {
    const auth = await requireModulePermission(req, 'subcontractors', 'create');
    const data = await parseBody(req);
    const { contract_id, date, certificate_number, description, gross_amount, retention_rate } = data;

    if (!auth.companyId || !contract_id || !date || !certificate_number || !gross_amount) {
      return error('company_id, contract_id, date, certificate_number, gross_amount are required');
    }

    const s = sb();

    // عزل مستأجرين: العقد يجب أن ينتمي لهذه الشركة
    const { data: contract } = await s.from('subcontractor_contracts')
      .select('*')
      .eq('id', contract_id)
      .eq('company_id', auth.companyId)
      .maybeSingle();

    if (!contract) return error('العقد غير موجود', 404);

    const rate = retention_rate ?? (contract as Record<string, any>).retention_rate ?? 0;
    const retentionAmount = gross_amount * rate;
    const netAmount = gross_amount - retentionAmount;

    // حل الحسابات قبل أي كتابة — القيد إلزامي متوازن
    const { data: costAccount } = await s.from('accounts')
      .select('id')
      .eq('company_id', auth.companyId)
      .eq('code', ACCOUNT_CODES.DIRECT_COSTS)
      .maybeSingle();
    const { data: apAccount } = await s.from('accounts')
      .select('id')
      .eq('company_id', auth.companyId)
      .eq('code', ACCOUNT_CODES.SUBCONTRACTOR_PAYABLES)
      .maybeSingle();
    if (!costAccount || !apAccount) {
      return error('حسابات التكلفة المباشرة (5100) أو مقاولي الباطن (2150) غير موجودة — راجع دليل الحسابات');
    }
    let retentionAccountId: string | null = null;
    if (retentionAmount > 0) {
      const { data: retentionAccount } = await s.from('accounts')
        .select('id')
        .eq('company_id', auth.companyId)
        .eq('code', ACCOUNT_CODES.RETENTIONS)
        .maybeSingle();
      if (!retentionAccount) return error('حساب محجوزات الضمان (2160) غير موجود');
      retentionAccountId = retentionAccount.id;
    }

    const { data: cert, error: certErr } = await s.from('subcontractor_certificates')
      .insert({
        company_id: auth.companyId,
        contract_id,
        date,
        certificate_number,
        description: description || null,
        gross_amount,
        retention_rate: rate,
        retention_amount: retentionAmount,
        net_amount: netAmount,
        status: 'approved',
      })
      .select('*')
      .single();

    if (certErr) throw certErr;

    // القيد: مدين التكلفة / دائن ذمم المقاول + محجوز الضمان (متوازن)
    const lines: Array<{ account_id: string; debit: number; credit: number }> = [
      { account_id: costAccount.id, debit: Number(gross_amount), credit: 0 },
      { account_id: apAccount.id, debit: 0, credit: Number(netAmount) },
    ];
    if (retentionAmount > 0 && retentionAccountId) {
      lines.push({ account_id: retentionAccountId, debit: 0, credit: Number(retentionAmount) });
    }

    const { createJournalEntry } = await import('@/lib/journal-utils');
    const je = await createJournalEntry(auth.companyId, {
      date,
      type: 'general',
      description: `شهادة مقاول باطن: ${certificate_number}`,
      lines,
      reference_type: 'subcon_certificate',
      reference_id: cert.id,
      created_by: auth.userId,
    });

    if (je.error || !je.journalId) {
      await s.from('subcontractor_certificates').delete().eq('id', cert.id).eq('company_id', auth.companyId);
      throw je.error || new Error('فشل قيد الشهادة');
    }

    const { data: linked, error: linkErr } = await s.from('subcontractor_certificates')
      .update({ journal_entry_id: je.journalId })
      .eq('id', cert.id)
      .eq('company_id', auth.companyId)
      .select('*')
      .single();
    if (linkErr) throw linkErr;

    return success(linked, 201);
  } catch (err) {
    return handleApiError(err);
  }
}
