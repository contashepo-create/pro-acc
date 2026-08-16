import { NextRequest } from 'next/server';
import { success, error, notFound, requireModulePermission, requireManagerOrAbove, handleApiError, parseBody } from '@/lib/api-helpers';
import { getSupabase } from '@/lib/supabase-client';
import { voucherUpdateSchema } from '@/lib/validation';

const sb = () => getSupabase();

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const ctx = await requireModulePermission(request, 'receipts', 'read');
    const { id } = await params;
    const s = sb();

    const { data: voucher } = await s.from('voucher_receipts')
      .select('*, contacts!contact_id(name), banks_safes!bank_safe_id(name), journal_entries!journal_entry_id(number)')
      .eq('id', id)
      .eq('company_id', ctx.companyId)
      .maybeSingle();

    if (!voucher) return notFound();

    const { data: invoiceItems } = await s.from('receipt_invoice_items')
      .select('*, invoices!invoice_id(number)')
      .eq('voucher_receipt_id', id)
      .eq('company_id', ctx.companyId);

    return success({
      ...(voucher as Record<string, any>),
      contact_name: (voucher as Record<string, any>).contacts?.name || null,
      bank_safe_name: (voucher as Record<string, any>).banks_safes?.name || null,
      journal_entry_number: (voucher as Record<string, any>).journal_entries?.number || null,
      invoice_items: (invoiceItems || []).map((ri: any) => ({
        ...ri,
        invoice_number: ri.invoices?.number || null,
      })),
    });
  } catch (err) {
    return handleApiError(err);
  }
}

/**
 * PUT /api/vouchers/receipt/[id]
 * تعديل سند = عكس القيد القديم (يبقى للتدقيق) + قيد جديد بالقيم الجديدة.
 * لا قيد غير متوازن أبداً: الحساب المقابل إلزامي الحل قبل أي كتابة.
 */
export async function PUT(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const ctx = await requireManagerOrAbove(request);
    const { id } = await params;
    const s = sb();
    const body = await parseBody(request);

    const parsed = voucherUpdateSchema.safeParse(body);
    if (!parsed.success) return error(parsed.error.issues[0].message);

    const { data: updated, error: updateError } = await s.rpc('update_voucher_receipt_atomic', {
      p_company_id: ctx.companyId,
      p_voucher_id: id,
      p_date: parsed.data.date || null,
      p_contact_id: parsed.data.contact_id || null,
      p_contact_set: Object.prototype.hasOwnProperty.call(body, 'contact_id'),
      p_amount: parsed.data.amount ?? null,
      p_bank_safe_id: parsed.data.bank_safe_id || null,
      p_reason: parsed.data.reason || '',
      p_user_id: ctx.userId,
    });
    if (updateError) throw updateError;
    return success(updated);
  } catch (err) {
    return handleApiError(err);
  }
}

/**
 * DELETE /api/vouchers/receipt/[id]
 * إلغاء ناعم: استرجاع التخصيصات + قيد عكسي + status='cancelled'.
 * القيد الأصلي والسند يبقيان للتدقيق — لا حذف مادي لأثر مالي.
 */
export async function DELETE(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const ctx = await requireManagerOrAbove(request);
    const { id } = await params;
    const s = sb();

    const { data: cancelled, error: cancelError } = await s.rpc('cancel_voucher_receipt_atomic', {
      p_company_id: ctx.companyId,
      p_voucher_id: id,
      p_user_id: ctx.userId,
    });
    if (cancelError) throw cancelError;
    return success(cancelled);
  } catch (err) {
    return handleApiError(err);
  }
}
