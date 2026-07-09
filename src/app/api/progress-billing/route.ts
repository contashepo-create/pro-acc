import { NextRequest } from 'next/server';
import { success, error, parseBody, getPaginationParams, requireApiAuth, handleApiError } from '@/lib/api-helpers';
import { getSupabase } from '@/lib/supabase-client';
import { ACCOUNT_CODES } from '@/lib/constants';

// @ts-ignore
const sb = () => getSupabase() as any;

export async function GET(req: NextRequest) {
  try {
    const auth = await requireApiAuth(req);
    const s = sb();
    const url = new URL(req.url);
    const { page, pageSize } = getPaginationParams(url);
    const projectId = url.searchParams.get('projectId');

    let query = s.from('progress_billing')
      .select('*, projects(name)', { count: 'exact' }).eq('company_id', auth.companyId);
    if (projectId) query = query.eq('project_id', projectId);

    const offset = (page - 1) * pageSize;
    const { data, error: queryError, count } = await query
      .order('date', { ascending: false }).range(offset, offset + pageSize - 1);
    if (queryError) throw queryError;

    const claims = (data || []).map((pb: any) => ({ ...pb, project_name: pb.projects?.name || null }));
    return success({ claims, total: count || 0, page, pageSize });
  } catch (err) { return handleApiError(err); }
}

export async function POST(req: NextRequest) {
  try {
    const auth = await requireApiAuth(req);
    const s = sb();
    const data = await parseBody(req);
    const { project_id, date, claim_number, description, gross_amount, retention_rate } = data;
    if (!project_id || !date || !claim_number || !gross_amount)
      return error('project_id, date, claim_number, gross_amount are required');

    const rate = retention_rate || 0;
    const retentionAmount = gross_amount * rate;
    const netAmount = gross_amount - retentionAmount;

    const { data: claim, error: claimErr } = await s.from('progress_billing')
      .insert({ company_id: auth.companyId, project_id, date, claim_number, description: description || null, gross_amount, retention_rate: rate, retention_amount: retentionAmount, net_amount: netAmount, status: 'approved' })
      .select('*').single();
    if (claimErr) throw claimErr;

    const { data: arAcc } = await s.from('accounts').select('id').eq('company_id', auth.companyId).eq('code', ACCOUNT_CODES.ACCRUED_REVENUE).maybeSingle();
    const { data: revAcc } = await s.from('accounts').select('id').eq('company_id', auth.companyId).eq('code', ACCOUNT_CODES.CONTRACT_REVENUE).maybeSingle();
    const { data: retAcc } = await s.from('accounts').select('id').eq('company_id', auth.companyId).eq('code', ACCOUNT_CODES.RETENTIONS).maybeSingle();

    if (arAcc && revAcc) {
      const { data: maxJe } = await s.from('journal_entries').select('number').eq('company_id', auth.companyId).order('number', { ascending: false }).limit(1).maybeSingle();
      const jeNum = ((maxJe as any)?.number || 0) + 1;
      const { data: je } = await s.from('journal_entries')
        .insert({ company_id: auth.companyId, number: jeNum, date, type: 'general', description: `فاتورة مرحلية: ${claim_number}`, reference_type: 'progress_billing', reference_id: claim.id, created_by: auth.userId })
        .select('id').single();
      const jl: any[] = [
        { journal_entry_id: je.id, account_id: arAcc.id, debit: gross_amount, credit: 0 },
        { journal_entry_id: je.id, account_id: revAcc.id, debit: 0, credit: netAmount },
      ];
      if (retentionAmount > 0 && retAcc) jl.push({ journal_entry_id: je.id, account_id: retAcc.id, debit: 0, credit: retentionAmount });
      await s.from('journal_lines').insert(jl);
    }
    return success(claim, 201);
  } catch (err) { return handleApiError(err); }
}
