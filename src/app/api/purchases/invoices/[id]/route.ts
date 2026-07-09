import { NextRequest } from 'next/server';
import { success, error, parseBody, notFound, requireApiAuth, handleApiError } from '@/lib/api-helpers';
import { getSupabase } from '@/lib/supabase-client';

// @ts-ignore
const sb = () => getSupabase() as any;

export async function GET(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const auth = await requireApiAuth(req);
    const { id } = await params;
    const s = sb();

    const { data: pi, error: piError } = await s.from('purchase_invoices')
      .select('*, contacts!supplier_id(name), purchase_orders!purchase_order_id(po_number)')
      .eq('id', id)
      .maybeSingle();

    if (piError || !pi) return notFound();

    const { data: items } = await s.from('purchase_invoice_items')
      .select('*')
      .eq('purchase_invoice_id', id)
      .order('id');

    const { data: paid } = await s.from('disbursement_invoice_items')
      .select('amount')
      .eq('purchase_invoice_id', id);

    const paidAmount = (paid || []).reduce((sum: number, p: any) => sum + (parseFloat(p.amount) || 0), 0);

    return success({
      ...pi,
      supplier_name: (pi as any).contacts?.name || null,
      po_number: (pi as any).purchase_orders?.po_number || null,
      items: items || [],
      paid_amount: paidAmount,
    });
  } catch (err) {
    return handleApiError(err);
  }
}

export async function PUT(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const auth = await requireApiAuth(req);
    const { id } = await params;
    const data = await parseBody(req);
    const s = sb();

    const updateData: any = { updated_at: new Date().toISOString() };
    if (data.status !== undefined) updateData.status = data.status;
    if (data.notes !== undefined) updateData.notes = data.notes;

    const { data: result, error: updateError } = await s.from('purchase_invoices')
      .update(updateData)
      .eq('id', id)
      .select('*')
      .maybeSingle();

    if (updateError || !result) return notFound();
    return success(result);
  } catch (err) {
    return handleApiError(err);
  }
}

export async function DELETE(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const auth = await requireApiAuth(req);
    const { id } = await params;
    const s = sb();

    const { data: inv } = await s.from('purchase_invoices')
      .select('journal_entry_id, company_id, created_by')
      .eq('id', id)
      .maybeSingle();

    if (!inv) return notFound();

    await s.from('purchase_invoice_items').delete().eq('purchase_invoice_id', id);
    await s.from('disbursement_invoice_items').delete().eq('purchase_invoice_id', id);

    if ((inv as any).journal_entry_id) {
      // Get JE data for reversal
      const { data: oldLines } = await s.from('journal_lines')
        .select('account_id, debit, credit')
        .eq('journal_entry_id', (inv as any).journal_entry_id);

      await s.from('journal_lines').delete().eq('journal_entry_id', (inv as any).journal_entry_id);

      const { data: oldJe } = await s.from('journal_entries')
        .select('company_id')
        .eq('id', (inv as any).journal_entry_id)
        .maybeSingle();

      if (oldJe) {
        const { data: maxJe } = await s.from('journal_entries')
          .select('number')
          .eq('company_id', oldJe.company_id)
          .order('number', { ascending: false })
          .limit(1)
          .maybeSingle();

        const nextNumber = (maxJe?.number || 0) + 1;

        const { data: revJe, error: revJeErr } = await s.from('journal_entries')
          .insert({
            company_id: oldJe.company_id,
            number: nextNumber,
            date: new Date().toISOString().split('T')[0],
            type: 'general',
            description: 'عكس فاتورة مشتريات ملغاة',
            created_by: (inv as any).created_by,
          })
          .select('*')
          .single();

        if (!revJeErr && revJe && oldLines && oldLines.length > 0) {
          const reversedLines = oldLines.map((l: any) => ({
            journal_entry_id: revJe.id,
            account_id: l.account_id,
            debit: l.credit,
            credit: l.debit,
          }));
          await s.from('journal_lines').insert(reversedLines);
        }
      }

      await s.from('journal_entries').delete().eq('id', (inv as any).journal_entry_id);
    }

    await s.from('purchase_invoices').delete().eq('id', id);

    return success({ deleted: true });
  } catch (err) {
    return handleApiError(err);
  }
}
