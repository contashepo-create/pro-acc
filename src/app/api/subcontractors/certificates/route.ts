import { NextRequest } from 'next/server';
import { success, error, parseBody, getPaginationParams, requireApiAuth, handleApiError } from '@/lib/api-helpers';
import { getSupabase } from '@/lib/supabase-client';
import { ACCOUNT_CODES } from '@/lib/constants';
import { getNextJournalNumber } from '@/lib/numbering';

const sb = () => getSupabase();

export async function GET(req: NextRequest) {
  try {
    const auth = await requireApiAuth(req);
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
    const auth = await requireApiAuth(req);
    const data = await parseBody(req);
    const { contract_id, date, certificate_number, description, gross_amount, retention_rate } = data;

    if (!auth.companyId || !contract_id || !date || !certificate_number || !gross_amount) {
      return error('company_id, contract_id, date, certificate_number, gross_amount are required');
    }

    const s = sb();

    const { data: contract } = await s.from('subcontractor_contracts')
      .select('*')
      .eq('id', contract_id)
      .maybeSingle();

    if (!contract) return error('العقد غير موجود');

    const rate = retention_rate ?? (contract as Record<string, any>).retention_rate ?? 0;
    const retentionAmount = gross_amount * rate;
    const netAmount = gross_amount - retentionAmount;

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

    // Get accounts
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

    const { data: retentionAccount } = await s.from('accounts')
      .select('id')
      .eq('company_id', auth.companyId)
      .eq('code', ACCOUNT_CODES.RETENTIONS)
      .maybeSingle();

    if (costAccount && apAccount) {
      // FIXED: Use atomic RPC-based numbering instead of manual MAX+1
      const nextNumber = await getNextJournalNumber(auth.companyId, date);

      const { data: je, error: jeErr } = await s.from('journal_entries')
        .insert({
          company_id: auth.companyId,
          number: nextNumber,
          date,
          type: 'general',
          description: `شهادة مقاول باطن: ${certificate_number}`,
          reference_type: 'subcon_certificate',
          reference_id: cert.id,
          created_by: auth.userId,
        })
        .select('*')
        .single();

      if (jeErr) throw jeErr;

      const lines: any[] = [
        { journal_entry_id: je.id, account_id: costAccount.id, debit: gross_amount, credit: 0 },
        { journal_entry_id: je.id, account_id: apAccount.id, debit: 0, credit: netAmount },
      ];
      if (retentionAmount > 0 && retentionAccount) {
        lines.push({ journal_entry_id: je.id, account_id: retentionAccount.id, debit: 0, credit: retentionAmount });
      }

      await s.from('journal_lines').insert(lines);
    }

    return success(cert, 201);
  } catch (err) {
    return handleApiError(err);
  }
}
