import { NextRequest } from 'next/server';
import { success, error, notFound, parseBody, requireApiAuth, handleApiError } from '@/lib/api-helpers';
import { getSupabase } from '@/lib/supabase-client';

const sb = () => getSupabase();

export async function GET(
  request: NextRequest,
  { params: paramsPromise }: { params: Promise<{ id: string }> }
) {
  try {
    const auth = await requireApiAuth(request);
    const { id } = await paramsPromise;
    const s = sb();

    const { data: invRes, error: invErr } = await s.from('invoices')
      .select('id, number, contact_id, project_id, date, due_date, subtotal, vat_rate, vat_amount, total, status, notes, journal_entry_id, created_by, created_at, contacts(name)')
      .eq('id', id).eq('company_id', auth.companyId).maybeSingle();
    if (invErr || !invRes) return notFound();

    const { data: itemsRes } = await s.from('invoice_items')
      .select('id, description, quantity, unit_price, total').eq('invoice_id', id).order('id');

    const inv: any = invRes;
    return success({ ...inv, client_name: inv.contacts?.name || '', items: itemsRes || [] });
  } catch (err) {
    return handleApiError(err);
  }
}

export async function PATCH(
  request: NextRequest,
  { params: paramsPromise }: { params: Promise<{ id: string }> }
) {
  try {
    const auth = await requireApiAuth(request);
    const { id } = await paramsPromise;
    const s = sb();
    const body = await parseBody<{ status: string; notes?: string }>(request);

    const { data: invRes } = await s.from('invoices')
      .select('id, number, total, status, journal_entry_id').eq('id', id).eq('company_id', auth.companyId).maybeSingle();
    if (!invRes) return notFound();
    const invoice: any = invRes;

    if (body.status === 'paid') {
      if (invoice.status === 'paid') return error('الفاتورة مدفوعة مسبقاً');
      if (invoice.status === 'cancelled') return error('لا يمكن دفع فاتورة ملغية');
      const { error: updErr } = await s.from('invoices')
        .update({ status: 'paid', updated_at: new Date().toISOString() }).eq('id', id);
      if (updErr) throw updErr;
      return success({ message: 'تم تسجيل الفاتورة كمدفوعة' });
    }

    if (body.status === 'cancelled') {
      if (invoice.status === 'cancelled') return error('الفاتورة ملغية مسبقاً');

      await s.from('invoices')
        .update({ status: 'cancelled', notes: body.notes || null, updated_at: new Date().toISOString() }).eq('id', id);

      if (invoice.journal_entry_id) {
        const year = new Date().getFullYear().toString();
        let reversalNumber: number;
        try {
          const { data: rpcData } = await s.rpc('next_journal_number', {
            p_company_id: auth.companyId,
            p_year: parseInt(year),
          });
          reversalNumber = rpcData as number;
        } catch {
          const { data: seqExisting } = await s.from('journal_sequences')
            .select('last_number').eq('company_id', auth.companyId).eq('year', year).maybeSingle();
          if (seqExisting) {
            reversalNumber = seqExisting.last_number + 1;
            await s.from('journal_sequences').update({ last_number: reversalNumber }).eq('company_id', auth.companyId).eq('year', year);
          } else {
            reversalNumber = 1;
            await s.from('journal_sequences').insert({ company_id: auth.companyId, year: parseInt(year), last_number: 1 });
          }
        }

        const { data: reversalRes, error: revErr } = await s.from('journal_entries')
          .insert({
            company_id: auth.companyId, number: reversalNumber, date: new Date().toISOString().split('T')[0],
            type: 'general', description: `قيد عكسي لفاتورة رقم ${invoice.number}`,
            reference: `REV-${invoice.number}`, created_by: auth.userId,
          }).select('id').single();
        if (revErr) throw revErr;
        const reversalEntryId = reversalRes.id;

        const { data: origLines } = await s.from('journal_lines')
          .select('account_id, account_code, debit, credit, description').eq('journal_entry_id', invoice.journal_entry_id);

        const reversedLines = (origLines || []).map((l: any) => ({
          journal_entry_id: reversalEntryId, account_id: l.account_id, account_code: l.account_code,
          debit: l.credit, credit: l.debit, description: `عكس: ${l.description || ''}`,
        }));
        if (reversedLines.length > 0) {
          await s.from('journal_lines').insert(reversedLines);
        }
      }
      return success({ message: 'تم إلغاء الفاتورة بنجاح' });
    }

    return error('حالة غير صالحة. الحالات المسموحة: paid, cancelled');
  } catch (err) {
    return handleApiError(err);
  }
}
