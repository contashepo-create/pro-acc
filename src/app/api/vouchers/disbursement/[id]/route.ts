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
    const ctx = await requireModulePermission(request, 'disbursements', 'read');
    const { id } = await params;
    const s = sb();

    const { data: voucher } = await s.from('voucher_disbursements')
      // العمود الصحيح number (كان sequence_number — join ميت يعيد null دائماً)
      .select('*, contacts!contact_id(name), banks_safes!bank_safe_id(name), journal_entries!journal_entry_id(number), employees!employee_id(name)')
      .eq('id', id)
      .eq('company_id', ctx.companyId)
      .maybeSingle();

    if (!voucher) return notFound();

    const { data: invoiceItems } = await s.from('disbursement_invoice_items')
      .select('*, purchase_invoices!purchase_invoice_id(invoice_number)')
      .eq('voucher_disbursement_id', id)
      .eq('company_id', ctx.companyId);

    return success({
      ...(voucher as Record<string, any>),
      contact_name: (voucher as Record<string, any>).contacts?.name || null,
      bank_safe_name: (voucher as Record<string, any>).banks_safes?.name || null,
      journal_entry_number: (voucher as Record<string, any>).journal_entries?.number || null,
      employee_name: (voucher as Record<string, any>).employees?.name || null,
      invoice_items: (invoiceItems || []).map((di: any) => ({
        ...di,
        invoice_number: di.purchase_invoices?.invoice_number || null,
      })),
    });
  } catch (err) {
    return handleApiError(err);
  }
}

/**
 * PUT /api/vouchers/disbursement/[id] — كان مفقوداً كلياً (الصفحة ترسل PUT → 405)
 * تعديل = عكس القيد القديم (يبقى للتدقيق) + قيد جديد بالاتجاه الصحيح.
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

    const { data: updated, error: updateError } = await s.rpc('update_voucher_disbursement_atomic', {
      p_company_id: ctx.companyId,
      p_voucher_id: id,
      p_date: parsed.data.date || null,
      p_contact_id: parsed.data.contact_id || null,
      p_contact_set: Object.prototype.hasOwnProperty.call(body, 'contact_id'),
      p_employee_id: parsed.data.employee_id || null,
      p_employee_set: Object.prototype.hasOwnProperty.call(body, 'employee_id'),
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
 * DELETE /api/vouchers/disbursement/[id]
 * إلغاء ناعم: استرجاع تخصيصات فواتير الشراء + قيد عكسي + status='cancelled'.
 * كان يحذف السند والقيد مادياً — تدمير كامل لسجل المدفوعات.
 */
export async function DELETE(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const ctx = await requireManagerOrAbove(request);
    const { id } = await params;
    const s = sb();

    const { data: cancelled, error: cancelError } = await s.rpc('cancel_voucher_disbursement_atomic', {
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
