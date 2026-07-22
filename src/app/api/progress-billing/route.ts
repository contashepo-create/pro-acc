import { NextRequest } from 'next/server';
import { success, error, parseBody, getPaginationParams, requireApiAuth, handleApiError } from '@/lib/api-helpers';
import { getSupabase } from '@/lib/supabase-client';
import { getNextJournalNumber } from '@/lib/numbering';
import { ACCOUNT_CODES } from '@/lib/constants';

const sb = () => getSupabase();

export async function GET(req: NextRequest) {
  try {
    const auth = await requireApiAuth(req);
    const s = sb();
    const url = new URL(req.url);
    const { page, pageSize } = getPaginationParams(url);
    const projectId = url.searchParams.get('projectId');

    let query = s.from('progress_billing')
      .select('*, projects(name)', { count: 'exact' })
      .eq('company_id', auth.companyId);
    if (projectId) query = query.eq('project_id', projectId);

    const offset = (page - 1) * pageSize;
    const { data, error: queryError, count } = await query
      .order('date', { ascending: false }).range(offset, offset + pageSize - 1);

    if (queryError) {
      // Table might not exist, return empty result
      console.warn('Progress billing table query error:', queryError);
      return success({ claims: [], total: 0, page, pageSize });
    }

    const claims = (data || []).map((pb: any) => ({ ...pb, project_name: pb.projects?.name || null }));
    return success({ claims, total: count || 0, page, pageSize });
  } catch (err) {
    return handleApiError(err);
  }
}

export async function POST(req: NextRequest) {
  try {
    const auth = await requireApiAuth(req);
    const s = sb();
    const data = await parseBody(req);
    const { project_id, date, claim_number, description, gross_amount, retention_rate, retention_percentage, is_final, notes, tax_rate, tax_enabled } = data;
    if (!project_id || !date || !gross_amount)
      return error('project_id, date, gross_amount are required');

    const rate = retention_rate !== undefined ? retention_rate : (retention_percentage ? retention_percentage / 100 : 0);
    const retentionAmount = gross_amount * rate;
    const netAmount = gross_amount - retentionAmount;
    const claimNumber = claim_number || `PB-${Date.now()}`;

    // VAT calculation
    const vRate = (tax_enabled !== false && tax_rate) ? tax_rate : 0;
    const taxAmount = netAmount * vRate;

    const { data: claim, error: claimErr } = await s.from('progress_billing')
      .insert({ company_id: auth.companyId, project_id, date, claim_number: claimNumber, description: description || notes || null, gross_amount, retention_rate: rate, retention_amount: retentionAmount, net_amount: netAmount, status: 'approved', is_final: is_final || false, tax_rate: vRate, tax_amount: taxAmount })
      .select('*').single();
    if (claimErr) throw claimErr;

    // Create journal entry with VAT
    try {
      const { data: arAcc } = await s.from('accounts').select('id').eq('company_id', auth.companyId).eq('code', ACCOUNT_CODES.ACCRUED_REVENUE).maybeSingle();
      const { data: revAcc } = await s.from('accounts').select('id').eq('company_id', auth.companyId).eq('code', ACCOUNT_CODES.CONTRACT_REVENUE).maybeSingle();
      const { data: retAcc } = await s.from('accounts').select('id').eq('company_id', auth.companyId).eq('code', ACCOUNT_CODES.RETENTIONS).maybeSingle();
      const { data: vatAcc } = await s.from('accounts').select('id').eq('company_id', auth.companyId).eq('code', ACCOUNT_CODES.VAT_SALES).maybeSingle();

      if (arAcc && revAcc) {
        const jeNum = await getNextJournalNumber(auth.companyId, date || new Date().toISOString());
        const { data: je } = await s.from('journal_entries')
          .insert({ company_id: auth.companyId, number: jeNum, date, type: 'general', description: `فاتورة مرحلية: ${claimNumber}`, reference_type: 'progress_billing', reference_id: claim.id, created_by: auth.userId })
          .select('id').single();

        const totalDebit = gross_amount + taxAmount;
        const jl: any[] = [
          { journal_entry_id: je.id, account_id: arAcc.id, debit: totalDebit, credit: 0 },
          { journal_entry_id: je.id, account_id: revAcc.id, debit: 0, credit: netAmount },
        ];
        if (retentionAmount > 0 && retAcc) jl.push({ journal_entry_id: je.id, account_id: retAcc.id, debit: 0, credit: retentionAmount });
        if (taxAmount > 0 && vatAcc) jl.push({ journal_entry_id: je.id, account_id: vatAcc.id, debit: 0, credit: taxAmount });
        await s.from('journal_lines').insert(jl);
      }
    } catch (journalError) {
      console.warn('Failed to create journal entry for progress billing:', journalError);
    }

    return success(claim, 201);
  } catch (err) {
    return handleApiError(err);
  }
}
