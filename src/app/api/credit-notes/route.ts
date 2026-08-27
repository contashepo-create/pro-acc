import { NextRequest } from 'next/server';
import { success, error, handleApiError, parseBody, getPaginationParams, requireModulePermission } from '@/lib/api-helpers';
import { getSupabase } from '@/lib/supabase-client';
import { isValidDate } from '@/lib/utils';

import type { Row } from '@/lib/types';

const sb = () => getSupabase();
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

/** GET /api/credit-notes?projectId=&invoiceId= */
export async function GET(request: NextRequest) {
  try {
    const auth = await requireModulePermission(request, 'credit_notes', 'read');
    const s = sb();
    const url = new URL(request.url);
    const { page, pageSize } = getPaginationParams(url);
    const projectId = url.searchParams.get('projectId');
    const invoiceId = url.searchParams.get('invoiceId');
    if (projectId && !UUID_RE.test(projectId)) return error('معرّف المشروع غير صالح');
    if (invoiceId && !UUID_RE.test(invoiceId)) return error('معرّف الفاتورة غير صالح');

    let query = s.from('credit_notes')
      .select('*', { count: 'exact' })
      .eq('company_id', auth.companyId)
      .eq('note_type', 'credit');
    if (projectId) query = query.eq('project_id', projectId);
    if (invoiceId) query = query.eq('invoice_id', invoiceId);

    const offset = (page - 1) * pageSize;
    const { data, error: queryError, count } = await query
      .order('date', { ascending: false })
      .range(offset, offset + pageSize - 1);
    if (queryError) throw queryError;

    const rows = (data || []) as Array<Record<string, unknown>>;
    const contactIds = [...new Set(rows.map((row) => row.contact_id).filter(Boolean))];
    const invoiceIds = [...new Set(rows.map((row) => row.invoice_id).filter(Boolean))];
    const projectIds = [...new Set(rows.map((row) => row.project_id).filter(Boolean))];
    const [contactsResult, invoicesResult, projectsResult] = await Promise.all([
      contactIds.length
        ? s.from('contacts').select('id, name').eq('company_id', auth.companyId).in('id', contactIds)
        : Promise.resolve({ data: [], error: null }),
      invoiceIds.length
        ? s.from('invoices').select('id, number').eq('company_id', auth.companyId).in('id', invoiceIds)
        : Promise.resolve({ data: [], error: null }),
      projectIds.length
        ? s.from('projects').select('id, name').eq('company_id', auth.companyId).in('id', projectIds)
        : Promise.resolve({ data: [], error: null }),
    ]);
    for (const result of [contactsResult, invoicesResult, projectsResult]) if (result.error) throw result.error;
    const names = (records: Row[] | null, value: string) => Object.fromEntries((records || []).map((record) => [record.id, record[value]]));
    const contactNames = names(contactsResult.data, 'name');
    const invoiceNumbers = names(invoicesResult.data, 'number');
    const projectNames = names(projectsResult.data, 'name');

    const creditNotes = rows.map((note) => ({
      ...note,
      contact_name: contactNames[String(note.contact_id)] || null,
      invoice_number: invoiceNumbers[String(note.invoice_id)] || null,
      project_name: projectNames[String(note.project_id)] || null,
    }));
    return success({ credit_notes: creditNotes, total: count || 0, page, pageSize });
  } catch (err) {
    return handleApiError(err);
  }
}

/**
 * POST /api/credit-notes
 * Create a credit note with proper journal entry
 */
export async function POST(request: NextRequest) {
  try {
    const auth = await requireModulePermission(request, 'credit_notes', 'create');
    const s = sb();
    const body = await parseBody(request);
    const { invoice_id, project_id, contact_id, reason, items, date } = body;

    if (typeof reason !== 'string' || !reason.trim() || reason.length > 1000) return error('السبب مطلوب');
    for (const [value, label] of [[invoice_id, 'الفاتورة'], [project_id, 'المشروع'], [contact_id, 'الطرف']] as const) {
      if (value !== undefined && value !== null && value !== ''
        && (typeof value !== 'string' || !UUID_RE.test(value))) return error(`معرّف ${label} غير صالح`);
    }
    if (!Array.isArray(items) || items.length === 0 || items.length > 200) return error('يجب إضافة بند واحد على الأقل');
    const normalizedItems = items.map((item: Row) => ({
      description: typeof item.description === 'string' ? item.description.trim() : '',
      quantity: Number(item.quantity), unit_price: Number(item.unit_price),
    }));
    if (normalizedItems.some((item) => !item.description || item.description.length > 500 || !Number.isFinite(item.quantity) || item.quantity <= 0 || !Number.isFinite(item.unit_price) || item.unit_price < 0)) return error('أحد بنود الإشعار غير صالح');

    const effectiveDate = date || new Date().toISOString().split('T')[0];
    if (typeof effectiveDate !== 'string' || !isValidDate(effectiveDate)) {
      return error('تاريخ الإشعار غير صالح');
    }
    const taxRate = Number(body.tax_rate ?? 0);
    if (!Number.isFinite(taxRate) || taxRate < 0 || taxRate > 1) {
      return error('نسبة الضريبة غير صالحة');
    }

    // The linked invoice is row-locked before the remaining credit is checked.
    // Number, note, lines, journal and audit then commit in one transaction.
    const { data: creditNote, error: createError } = await s.rpc('create_credit_note_atomic', {
      p_company_id: auth.companyId,
      p_invoice_id: invoice_id || null,
      p_project_id: project_id || null,
      p_contact_id: contact_id || null,
      p_date: effectiveDate,
      p_reason: reason.trim(),
      p_items: normalizedItems,
      p_tax_rate: taxRate,
      p_user_id: auth.userId,
    });
    if (createError) throw createError;
    return success(creditNote, 201);
  } catch (err) {
    return handleApiError(err);
  }
}
