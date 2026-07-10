import { NextRequest } from 'next/server';
import { success, error, parseBody, getPaginationParams, validationError, requireApiAuth, handleApiError } from '@/lib/api-helpers';
import { getSupabase } from '@/lib/supabase-client';
import { getNextJournalNumber } from '@/lib/numbering';
import { generateId } from '@/lib/utils';
import { projectSchema } from '@/lib/validation';

// @ts-ignore
const sb = () => getSupabase() as any;

const CASH_CUSTOMER_NAME = 'عميل نقدي';

export async function GET(request: NextRequest) {
  try {
    const auth = await requireApiAuth(request);
    const s = sb();
    const url = new URL(request.url);
    const { page, pageSize } = getPaginationParams(url);
    const status = url.searchParams.get('status');

    let query = s.from('projects')
      .select('*, contacts(name)', { count: 'exact' })
      .eq('company_id', auth.companyId);
    if (status) query = query.eq('status', status);

    const offset = (page - 1) * pageSize;
    const { data, error: queryError, count } = await query
      .order('created_at', { ascending: false })
      .range(offset, offset + pageSize - 1);

    if (queryError) throw queryError;

    const rows = (data || []).map((p: any) => ({ ...p, client_name: p.contacts?.name || null }));
    return success({ rows, total: count || 0, page, pageSize, totalPages: Math.ceil((count || 0) / pageSize) });
  } catch (err) {
    return handleApiError(err);
  }
}

export async function POST(request: NextRequest) {
  try {
    const auth = await requireApiAuth(request);
    const s = sb();
    const body = await parseBody<{
      name: string; client_id?: string | null; contract_value: number;
      start_date: string; end_date?: string | null; status?: string;
      description?: string; location?: string; auto_invoice?: boolean;
    }>(request);

    const parsed = projectSchema.safeParse(body);
    if (!parsed.success) {
      return validationError(parsed.error.flatten().fieldErrors as Record<string, string[]>);
    }

    const projectId = generateId();
    let effectiveClientId = body.client_id || null;

    if (!effectiveClientId) {
      const { data: cashContact } = await s.from('contacts')
        .select('id').eq('name', CASH_CUSTOMER_NAME).eq('company_id', auth.companyId).eq('type', 'client').maybeSingle();

      if (cashContact) {
        effectiveClientId = cashContact.id;
      } else {
        const cashContactId = generateId();
        const cashAccountId = generateId();
        await s.from('accounts').insert({
          id: cashAccountId, company_id: auth.companyId, code: '1130',
          name: CASH_CUSTOMER_NAME, type: 'asset', is_active: true,
        });
        await s.from('contacts').insert({
          id: cashContactId, company_id: auth.companyId, name: CASH_CUSTOMER_NAME,
          type: 'client', account_id: cashAccountId, is_cash_customer: true,
        });
        effectiveClientId = cashContactId;
      }
    }

    await s.from('projects').insert({
      id: projectId, company_id: auth.companyId, name: body.name, client_id: effectiveClientId,
      contract_value: body.contract_value, start_date: body.start_date, end_date: body.end_date || null,
      status: body.status || 'active', description: body.description || null,
      location: body.location || null, created_by: auth.userId,
    });

    let invoice = null;

    if (body.auto_invoice && effectiveClientId) {
      const invoiceId = generateId();
      const jeId = generateId();
      const { data: maxJe } = await s.from('journal_entries')
        .select('number').eq('company_id', auth.companyId).order('number', { ascending: false }).limit(1).maybeSingle();
      const invSeq = ((maxJe as any)?.number || 0) + 1;
      const invoiceNumber = `INV-${projectId.substring(0, 8).toUpperCase()}`;

      await s.from('journal_entries').insert({
        id: jeId, company_id: auth.companyId, number: invSeq, date: body.start_date,
        type: 'invoice', description: `فاتورة مشروع: ${body.name}`, project_id: projectId, created_by: auth.userId,
      });

      const { data: arContact } = await s.from('contacts').select('account_id').eq('id', effectiveClientId).maybeSingle();
      if (!arContact?.account_id) throw new Error('العميل ليس لديه حساب ذمم مدينة');

      const { data: revAcc } = await s.from('accounts').select('id').eq('code', '4100').eq('company_id', auth.companyId).maybeSingle();

      await s.from('journal_lines').insert([
        { id: generateId(), journal_entry_id: jeId, account_id: arContact.account_id, debit: body.contract_value, credit: 0, description: `فاتورة مشروع: ${body.name}`, project_id: projectId, contact_id: effectiveClientId },
        { id: generateId(), journal_entry_id: jeId, account_id: revAcc?.id, debit: 0, credit: body.contract_value, description: `فاتورة مشروع: ${body.name}`, project_id: projectId, contact_id: effectiveClientId },
      ]);

      await s.from('invoices').insert({
        id: invoiceId, company_id: auth.companyId, number: invoiceNumber, contact_id: effectiveClientId,
        project_id: projectId, date: body.start_date, due_date: body.start_date, subtotal: body.contract_value,
        vat_rate: 0, vat_amount: 0, total: body.contract_value, paid_amount: 0, status: 'unpaid',
        journal_entry_id: jeId, created_by: auth.userId,
      });

      await s.from('invoice_items').insert({
        id: generateId(), invoice_id: invoiceId, description: `أعمال مشروع: ${body.name}`,
        quantity: 1, unit_price: body.contract_value, total: body.contract_value,
      });

      invoice = { id: invoiceId, number: invoiceNumber };
    }

    const { data: projectRes, error: fetchErr } = await s.from('projects')
      .select('*, contacts(name)').eq('id', projectId).single();
    if (fetchErr) throw fetchErr;

    const result: any = projectRes;
    return success({ ...result, client_name: result.contacts?.name || null, invoice }, 201);
  } catch (err) {
    return handleApiError(err);
  }
}
