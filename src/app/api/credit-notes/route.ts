import { NextRequest } from 'next/server';
import { success, error, handleApiError, parseBody, getPaginationParams, requireModulePermission } from '@/lib/api-helpers';
import { getSupabase } from '@/lib/supabase-client';

const sb = () => getSupabase();

/**
 * GET /api/credit-notes?projectId=&invoiceId=
 */
export async function GET(request: NextRequest) {
  try {
    const auth = await requireModulePermission(request, 'credit_notes', 'read');
    const s = sb();
    const url = new URL(request.url);
    const { page, pageSize } = getPaginationParams(url);
    const projectId = url.searchParams.get('projectId');
    const invoiceId = url.searchParams.get('invoiceId');

    let query = s.from('credit_notes')
      .select('*, contacts(name), invoices(number), projects(name)', { count: 'exact' })
      .eq('company_id', auth.companyId);

    if (projectId) query = query.eq('project_id', projectId);
    if (invoiceId) query = query.eq('invoice_id', invoiceId);

    const offset = (page - 1) * pageSize;
    const { data, error: err, count } = await query
      .order('date', { ascending: false })
      .range(offset, offset + pageSize - 1);

    if (err) {
      console.warn('Credit notes query error:', err);
      return success({ credit_notes: [], total: 0, page, pageSize });
    }

    const creditNotes = (data || []).map((cn: any) => ({
      ...cn,
      contact_name: cn.contacts?.name || null,
      invoice_number: cn.invoices?.number || null,
      project_name: cn.projects?.name || null,
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
    if (!Array.isArray(items) || items.length === 0 || items.length > 200) return error('يجب إضافة بند واحد على الأقل');
    const normalizedItems = items.map((item: any) => ({
      description: typeof item.description === 'string' ? item.description.trim() : '',
      quantity: Number(item.quantity), unit_price: Number(item.unit_price),
    }));
    if (normalizedItems.some((item: any) => !item.description || item.description.length > 500 || !Number.isFinite(item.quantity) || item.quantity <= 0 || !Number.isFinite(item.unit_price) || item.unit_price < 0)) return error('أحد بنود الإشعار غير صالح');

    const effectiveDate = date || new Date().toISOString().split('T')[0];
    if (!/^\d{4}-\d{2}-\d{2}$/.test(effectiveDate)
      || !Number.isFinite(Date.parse(`${effectiveDate}T00:00:00Z`))) {
      return error('تاريخ الإشعار غير صالح');
    }
    const taxRate = Number(body.tax_rate || 0);
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
