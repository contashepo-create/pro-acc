import { NextRequest } from 'next/server';
import { success, error, parseBody, requireApiAuth, handleApiError } from '@/lib/api-helpers';
import { getSupabase } from '@/lib/supabase-client';
import { invoiceSchema } from '@/lib/validation';

// @ts-ignore
const sb = () => getSupabase() as any;

export async function GET(request: NextRequest) {
  try {
    const auth = await requireApiAuth(request);
    const s = sb();
    const url = request.nextUrl;
    const page = Math.max(1, parseInt(url.searchParams.get('page') || '1', 10) || 1);
    const pageSize = Math.min(500, Math.max(1, parseInt(url.searchParams.get('pageSize') || '50', 10) || 50));
    const status = url.searchParams.get('status');
    const clientId = url.searchParams.get('client_id');
    const dateFrom = url.searchParams.get('from');
    const dateTo = url.searchParams.get('to');

    let query = s.from('invoices')
      .select('id, number, contact_id, project_id, date, due_date, subtotal, vat_rate, vat_amount, total, status, notes, journal_entry_id, created_at, contacts(name)', { count: 'exact' })
      .eq('company_id', auth.companyId);
    if (status) query = query.eq('status', status);
    if (clientId) query = query.eq('contact_id', clientId);
    if (dateFrom) query = query.gte('date', dateFrom);
    if (dateTo) query = query.lte('date', dateTo);

    const offset = (page - 1) * pageSize;
    const { data, error: queryError, count } = await query
      .order('date', { ascending: false }).order('number', { ascending: false })
      .range(offset, offset + pageSize - 1);

    if (queryError) throw queryError;

    const invoices = (data || []).map((i: any) => ({
      ...i, client_name: i.contacts?.name || '',
    }));

    return success({ invoices, total: count || 0, page, pageSize, totalPages: Math.ceil((count || 0) / pageSize) || 1 });
  } catch (err) {
    return handleApiError(err);
  }
}

export async function POST(request: NextRequest) {
  try {
    const auth = await requireApiAuth(request);
    const s = sb();
    const body = await parseBody(request);
    const parsed = invoiceSchema.safeParse(body);
    if (!parsed.success) return error(parsed.error.issues[0].message);

    const { clientId, projectId, date, dueDate, items, subtotal, vatRate, vatAmount, total, notes } = parsed.data;
    const year = date.substring(0, 4);

    // FIXED: Atomic sequence generation via SQL function to avoid race condition
    // Fallback to old logic if function doesn't exist yet
    let number: number;
    try {
      const { data: rpcData, error: rpcError } = await s.rpc('next_invoice_number', {
        p_company_id: auth.companyId,
        p_year: parseInt(year),
      });
      if (rpcError || rpcData == null) throw rpcError || new Error('RPC failed');
      number = rpcData as number;
    } catch {
      // Fallback (old logic) - will be removed after migration 007 runs
      const { data: seqExisting } = await s.from('invoice_sequences')
        .select('last_number').eq('company_id', auth.companyId).eq('year', year).maybeSingle();
      if (seqExisting) {
        number = seqExisting.last_number + 1;
        await s.from('invoice_sequences').update({ last_number: number }).eq('company_id', auth.companyId).eq('year', year);
      } else {
        number = 1;
        await s.from('invoice_sequences').insert({ company_id: auth.companyId, year: parseInt(year), last_number: 1 });
      }
    }

    const computedVat = vatAmount ?? subtotal * vatRate;
    const computedTotal = total ?? subtotal + computedVat;

    // Use transaction-like pattern with manual rollback
    let invoiceId: string | null = null;
    let journalEntryId: string | null = null;

    try {
      const { data: invoiceRes, error: invErr } = await s.from('invoices')
        .insert({
          company_id: auth.companyId, number, contact_id: clientId, project_id: projectId || null,
          date, due_date: dueDate, subtotal, vat_rate: vatRate, vat_amount: computedVat,
          total: computedTotal, status: 'unpaid', notes: notes || null, created_by: auth.userId,
        })
        .select('id, number, date, due_date, subtotal, vat_rate, vat_amount, total, status, notes')
        .single();
      if (invErr) throw invErr;
      invoiceId = invoiceRes.id;

      for (const item of items) {
        const itemTotal = item.total ?? item.quantity * item.unitPrice;
        const { error: itemErr } = await s.from('invoice_items').insert({
          invoice_id: invoiceId, description: item.description, quantity: item.quantity,
          unit_price: item.unitPrice, total: itemTotal,
        });
        if (itemErr) throw itemErr;
      }

      const { data: arAccount } = await s.from('accounts').select('id').eq('company_id', auth.companyId).eq('code', '1130').maybeSingle();
      const { data: revenueAccount } = await s.from('accounts').select('id').eq('company_id', auth.companyId).eq('code', '4100').maybeSingle();
      const { data: vatAccount } = await s.from('accounts').select('id').eq('company_id', auth.companyId).eq('code', '2120').maybeSingle();

      if (!arAccount || !revenueAccount) {
        throw new Error('الحسابات الأساسية مفقودة. يرجى التأكد من وجود حسابات العملاء (1130) والإيرادات (4100)');
      }

      const { data: jeRes, error: jeErr } = await s.from('journal_entries')
        .insert({
          company_id: auth.companyId, number, date, type: 'general',
          description: `فاتورة مبيعات رقم ${number}`, reference: `INV-${number}`, created_by: auth.userId,
        }).select('id').single();
      if (jeErr) throw jeErr;
      journalEntryId = jeRes.id;

      const journalLines: any[] = [
        { journal_entry_id: journalEntryId, account_id: arAccount.id, account_code: '1130', debit: computedTotal, credit: 0, description: `فاتورة مبيعات رقم ${number}` },
        { journal_entry_id: journalEntryId, account_id: revenueAccount.id, account_code: '4100', debit: 0, credit: subtotal, description: `إيراد فاتورة رقم ${number}` },
      ];
      if (computedVat > 0 && vatAccount) {
        journalLines.push({ journal_entry_id: journalEntryId, account_id: vatAccount.id, account_code: '2120', debit: 0, credit: computedVat, description: `ضريبة فاتورة رقم ${number}` });
      }
      const { error: linesErr } = await s.from('journal_lines').insert(journalLines);
      if (linesErr) throw linesErr;

      const { error: updateErr } = await s.from('invoices').update({ journal_entry_id: journalEntryId }).eq('id', invoiceId);
      if (updateErr) throw updateErr;

      const { data: itemsRes } = await s.from('invoice_items')
        .select('id, description, quantity, unit_price, total').eq('invoice_id', invoiceId);

      return success({ ...invoiceRes, items: itemsRes || [], journalEntryId }, 201);
    } catch (txErr: any) {
      // Rollback on failure
      console.error('Invoice creation failed, rolling back:', txErr);
      try {
        if (journalEntryId) {
          await s.from('journal_lines').delete().eq('journal_entry_id', journalEntryId);
          await s.from('journal_entries').delete().eq('id', journalEntryId);
        }
        if (invoiceId) {
          await s.from('invoice_items').delete().eq('invoice_id', invoiceId);
          await s.from('invoices').delete().eq('id', invoiceId);
        }
      } catch (rollbackErr) {
        console.error('Rollback failed:', rollbackErr);
      }
      throw txErr;
    }
  } catch (err: any) {
    if (err.message?.includes('مفقودة')) return error(err.message);
    return handleApiError(err);
  }
}
