import { NextRequest } from 'next/server';
import { success, error, notFound, parseBody, requireApiAuth, requireModulePermission, handleApiError } from '@/lib/api-helpers';
import { getSupabase } from '@/lib/supabase-client';

const sb = () => getSupabase();

export async function GET(
  request: NextRequest,
  { params: paramsPromise }: { params: Promise<{ id: string }> }
) {
  try {
    const auth = await requireModulePermission(request, 'invoices', 'read');
    const { id } = await paramsPromise;
    const s = sb();

    // Schema-drift resilient: vat_* vs tax_*, optional deleted_at / contacts embed.
    let invRes: any = null;
    let invErr: any = null;
    const primary = await s.from('invoices')
      .select(`
        id, number, contact_id, project_id, date, due_date, subtotal,
        vat_rate, vat_amount, tax_rate, tax_amount, total, paid_amount, status, notes,
        journal_entry_id, created_by, created_at,
        contacts(id, name, tax_number, address, phone, email, commercial_registration)
      `)
      .eq('id', id).eq('company_id', auth.companyId).maybeSingle();
    invRes = primary.data; invErr = primary.error;

    if (invErr) {
      const fallback = await s.from('invoices')
        .select('id, number, contact_id, project_id, date, due_date, subtotal, total, paid_amount, status, notes, journal_entry_id, created_by, created_at')
        .eq('id', id).eq('company_id', auth.companyId).maybeSingle();
      invRes = fallback.data; invErr = fallback.error;
    }
    if (invErr || !invRes) return notFound();

    const { data: itemsRes } = await s.from('invoice_items')
      .select('id, description, quantity, unit_price, total, barcode')
      .eq('invoice_id', id).eq('company_id', auth.companyId).order('id');

    // Fetch company info with all relevant fields
    const { data: company } = await s.from('companies')
      .select('name, tax_number, commercial_registration, address, phone, email, currency_symbol, currency_code, locale, country_code, logo_url, vat_rate')
      .eq('id', auth.companyId).maybeSingle();

    // Fetch project name if linked
    let projectName: string | null = null;
    const inv = invRes as Record<string, any>;
    if (inv.project_id) {
      const { data: proj } = await s.from('projects')
        .select('name').eq('id', inv.project_id).eq('company_id', auth.companyId).maybeSingle();
      projectName = (proj as any)?.name || null;
    }

    // Fetch the user who created the invoice
    let createdBy: string | null = null;
    if (inv.created_by) {
      const { data: user } = await s.from('users')
        .select('name').eq('id', inv.created_by).eq('company_id', auth.companyId).maybeSingle();
      createdBy = (user as any)?.name || null;
    }

    // Fetch journal entry lines for this invoice (for display)
    let journalLines: any[] = [];
    if (inv.journal_entry_id) {
      const { data: jl } = await s.from('journal_lines')
        .select('id, account_id, account_code, account_name, debit, credit, description')
        .eq('journal_entry_id', inv.journal_entry_id)
        .eq('company_id', auth.companyId);
      journalLines = jl || [];
    }

    let contact = (inv.contacts as Record<string, any> | null) || null;
    if ((!contact || !contact.name) && inv.contact_id) {
      const { data: cRow } = await s.from('contacts')
        .select('id, name, tax_number, address, phone, email, commercial_registration, city, region, postal_code, national_id, contact_person')
        .eq('id', inv.contact_id)
        .eq('company_id', auth.companyId)
        .maybeSingle();
      if (cRow) contact = cRow as Record<string, any>;
    }

    return success({
      ...inv,
      client_name: contact?.name || '',
      client_tax_number: contact?.tax_number || null,
      client_address: contact?.address || null,
      client_phone: contact?.phone || null,
      client_email: contact?.email || null,
      client_commercial_registration: contact?.commercial_registration || null,
      client_city: contact?.city || null,
      client_contact_person: contact?.contact_person || null,
      project_name: projectName,
      created_by_name: createdBy,
      items: itemsRes || [],
      company: company || {},
      journal_lines: journalLines,
    });
  } catch (err) {
    return handleApiError(err);
  }
}

export async function PUT(
  request: NextRequest,
  { params: paramsPromise }: { params: Promise<{ id: string }> }
) {
  try {
    const auth = await requireModulePermission(request, 'invoices', 'update');
    const { id } = await paramsPromise;
    const s = sb();
    const body = await parseBody<any>(request);
    const { data: existing } = await s.from('invoices')
      .select('id, status, journal_entry_id, notes, due_date')
      .eq('id', id).eq('company_id', auth.companyId).maybeSingle();
    if (!existing) return notFound();
    if ((existing as any).status === 'cancelled') return error('لا يمكن تعديل فاتورة ملغاة', 409);

    // Posted invoices are immutable. Corrections require cancellation/reversal
    // followed by a new invoice; in-place rewriting breaks the audit trail.
    const immutableFields = [
      'items', 'date', 'clientId', 'contact_id', 'projectId', 'project_id',
      'vatRate', 'vat_rate', 'vatEnabled', 'subtotal', 'total',
    ];
    if (immutableFields.some((field) => body[field] !== undefined)) {
      return error('لا يمكن تعديل البيانات المحاسبية لفاتورة مرحّلة؛ ألغِ الفاتورة وأنشئ أخرى', 409);
    }
    const update: Record<string, unknown> = {};
    if (body.notes !== undefined) {
      if (typeof body.notes !== 'string' || body.notes.length > 2000) return error('الملاحظات طويلة جداً');
      update.notes = body.notes.trim() || null;
    }
    const dueDate = body.dueDate ?? body.due_date;
    if (dueDate !== undefined) {
      if (typeof dueDate !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(dueDate)) return error('تاريخ الاستحقاق غير صالح');
      update.due_date = dueDate;
    }
    if (!Object.keys(update).length) return error('لا توجد حقول قابلة للتعديل');
    const { data: updated, error: updateError } = await s.from('invoices')
      .update({ ...update, updated_at: new Date().toISOString() })
      .eq('id', id).eq('company_id', auth.companyId).select('*').maybeSingle();
    if (updateError) throw updateError;
    if (!updated) return notFound();
    return success(updated);
  } catch (err) {
    return handleApiError(err);
  }
}

export async function PATCH(
  request: NextRequest,
  { params: paramsPromise }: { params: Promise<{ id: string }> }
) {
  try {
    const auth = await requireModulePermission(request, 'invoices', 'update');
    const { id } = await paramsPromise;
    const s = sb();
    const body = await parseBody<{ status: string; notes?: string }>(request);

    const { data: invRes } = await s.from('invoices')
      .select('id, number, total, status, journal_entry_id, paid_amount').eq('id', id).eq('company_id', auth.companyId).maybeSingle();
    if (!invRes) return notFound();
    const invoice = invRes as Record<string, any>;

    if (body.status === 'paid') {
      return error('لا يمكن تعليم الفاتورة مدفوعة يدوياً. سجّل سند قبض وخصّصه على الفاتورة');
    }

    if (body.status === 'cancelled') {
      if (invoice.status === 'cancelled') return error('الفاتورة ملغية مسبقاً');
      const paidAmt = parseFloat(invoice.paid_amount || '0') || 0;
      if (paidAmt > 0.005 || invoice.status === 'paid' || invoice.status === 'partial') {
        return error('لا يمكن إلغاء فاتورة عليها تحصيل — اعكس سندات القبض أولاً');
      }
      const { data: credits } = await s.from('credit_notes').select('id')
        .eq('company_id', auth.companyId).eq('invoice_id', id).eq('status', 'approved').limit(1);
      if (credits?.length) return error('لا يمكن إلغاء فاتورة لها إشعارات دائنة معتمدة؛ ألغِ الإشعارات أولاً', 409);

      if (invoice.journal_entry_id) {
        const { postReversalEntry } = await import('@/lib/voucher-utils');
        const { error: revErr } = await postReversalEntry(auth.companyId, {
          journalEntryId: invoice.journal_entry_id,
          referenceType: 'invoice_reversal',
          referenceId: id,
          description: `قيد عكسي لفاتورة رقم ${invoice.number}`,
          userId: auth.userId,
        });
        if (revErr) throw revErr;
      }

      await s.from('invoices')
        .update({ status: 'cancelled', notes: body.notes || null, updated_at: new Date().toISOString() })
        .eq('id', id).eq('company_id', auth.companyId);
      return success({ message: 'تم إلغاء الفاتورة بنجاح' });
    }

    return error('حالة غير صالحة. الحالات المسموحة: paid, cancelled');
  } catch (err) {
    return handleApiError(err);
  }
}
