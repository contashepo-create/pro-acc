import { NextRequest } from 'next/server';
import { success, error, notFound, parseBody, requireModulePermission, handleApiError } from '@/lib/api-helpers';
import { getSupabase } from '@/lib/supabase-client';
import { isValidDate } from '@/lib/utils';

import type { Row } from '@/lib/types';

const sb = () => getSupabase();
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export async function GET(
  request: NextRequest,
  { params: paramsPromise }: { params: Promise<{ id: string }> }
) {
  try {
    const auth = await requireModulePermission(request, 'invoices', 'read');
    const { id } = await paramsPromise;
    if (!UUID_RE.test(id)) return error('معرّف الفاتورة غير صالح');
    const s = sb();

    const { data: invoice, error: invoiceError } = await s.from('invoices')
      .select(`
        id, number, contact_id, project_id, date, due_date, subtotal,
        vat_rate, vat_amount, total, paid_amount, status, notes,
        journal_entry_id, created_by, created_at, tax_snapshot
      `)
      .eq('id', id).eq('company_id', auth.companyId).is('deleted_at', null).maybeSingle();
    if (invoiceError) throw invoiceError;
    if (!invoice) return notFound();
    const inv = invoice as Row;

    const { data: itemsRes, error: itemsError } = await s.from('invoice_items')
      .select('id, description, quantity, unit_price, total, barcode')
      .eq('invoice_id', id).eq('company_id', auth.companyId).order('id');
    if (itemsError) throw itemsError;

    const { data: company, error: companyError } = await s.from('companies')
      .select('name, tax_number, commercial_registration, address, phone, email, currency_symbol, currency_code, locale, country_code, logo_url, vat_rate')
      .eq('id', auth.companyId).maybeSingle();
    if (companyError) throw companyError;
    if (!company) throw new Error('Invoice company is missing');

    const { data: contact, error: contactError } = await s.from('contacts')
      .select('id, name, tax_number, address, phone, email, commercial_registration, city, region, postal_code, national_id, contact_person')
      .eq('id', inv.contact_id).eq('company_id', auth.companyId).maybeSingle();
    if (contactError) throw contactError;
    if (!contact) throw new Error('Invoice contact is missing or belongs to another tenant');
    const contactRow = contact as Row;

    let projectName: string | null = null;
    if (inv.project_id) {
      const { data: project, error: projectError } = await s.from('projects')
        .select('name').eq('id', inv.project_id).eq('company_id', auth.companyId).maybeSingle();
      if (projectError) throw projectError;
      if (!project) throw new Error('Invoice project is missing or belongs to another tenant');
      projectName = String((project as Row).name);
    }

    let createdBy: string | null = null;
    if (inv.created_by) {
      const { data: user, error: userError } = await s.from('users')
        .select('name').eq('id', inv.created_by).eq('company_id', auth.companyId).maybeSingle();
      if (userError) throw userError;
      createdBy = user ? String((user as Row).name) || null : null;
    }

    let journalLines: Row[] = [];
    if (inv.journal_entry_id) {
      const { data: entry, error: entryError } = await s.from('journal_entries')
        .select('id').eq('id', inv.journal_entry_id).eq('company_id', auth.companyId).maybeSingle();
      if (entryError) throw entryError;
      if (!entry) throw new Error('Invoice journal entry is missing or belongs to another tenant');
      const { data: lines, error: linesError } = await s.from('journal_lines')
        .select('id, account_id, account_code, account_name, debit, credit, description')
        .eq('journal_entry_id', inv.journal_entry_id).eq('company_id', auth.companyId);
      if (linesError) throw linesError;
      journalLines = lines || [];
    }

    return success({
      ...inv,
      client_name: contactRow.name || '',
      client_tax_number: contactRow.tax_number || null,
      client_address: contactRow.address || null,
      client_phone: contactRow.phone || null,
      client_email: contactRow.email || null,
      client_commercial_registration: contactRow.commercial_registration || null,
      client_city: contactRow.city || null,
      client_contact_person: contactRow.contact_person || null,
      project_name: projectName,
      created_by_name: createdBy,
      items: itemsRes || [],
      company,
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
    if (!UUID_RE.test(id)) return error('معرّف الفاتورة غير صالح');
    const s = sb();
    const body = await parseBody<Row>(request);
    // Posted financial fields are immutable; only presentation metadata can
    // change, under a row lock that cannot race with cancellation.
    const immutableFields = [
      'items', 'date', 'clientId', 'contact_id', 'projectId', 'project_id',
      'vatRate', 'vat_rate', 'vatAmount', 'vat_amount', 'tax_rate', 'tax_amount',
      'vatEnabled', 'subtotal', 'total',
    ];
    if (immutableFields.some((field) => body[field] !== undefined)) {
      return error('لا يمكن تعديل البيانات المحاسبية لفاتورة مرحّلة؛ ألغِ الفاتورة وأنشئ أخرى', 409);
    }
    if (body.notes !== undefined && (typeof body.notes !== 'string' || body.notes.length > 2000)) {
      return error('الملاحظات طويلة جداً');
    }
    const dueDate = body.dueDate ?? body.due_date;
    if (dueDate !== undefined && (typeof dueDate !== 'string' || !isValidDate(dueDate))) {
      return error('تاريخ الاستحقاق غير صالح');
    }
    if (body.notes === undefined && dueDate === undefined) return error('لا توجد حقول قابلة للتعديل');
    const { data: updated, error: updateError } = await s.rpc('update_sales_invoice_metadata', {
      p_company_id: auth.companyId,
      p_invoice_id: id,
      p_due_date: dueDate || null,
      p_notes: typeof body.notes === 'string' ? body.notes : '',
      p_notes_set: body.notes !== undefined,
      p_user_id: auth.userId,
    });
    if (updateError) throw updateError;
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
    if (!UUID_RE.test(id)) return error('معرّف الفاتورة غير صالح');
    const s = sb();
    const body = await parseBody<{ status: string; notes?: string }>(request);

    if (body.status === 'paid') {
      return error('لا يمكن تعليم الفاتورة مدفوعة يدوياً. سجّل سند قبض وخصّصه على الفاتورة');
    }
    if (body.status !== 'cancelled') {
      return error('حالة غير صالحة. الحالة المسموحة هنا: cancelled');
    }
    if (body.notes !== undefined && (typeof body.notes !== 'string' || body.notes.length > 2000)) {
      return error('الملاحظات طويلة جداً');
    }
    const { data: cancelled, error: cancelError } = await s.rpc('cancel_sales_invoice_atomic', {
      p_company_id: auth.companyId,
      p_invoice_id: id,
      p_notes: body.notes || '',
      p_user_id: auth.userId,
    });
    if (cancelError) throw cancelError;
    return success(cancelled);
  } catch (err) {
    return handleApiError(err);
  }
}
