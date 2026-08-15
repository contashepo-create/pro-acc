import { NextRequest } from 'next/server';
import { success, error, parseBody, requireModulePermission, handleApiError } from '@/lib/api-helpers';
import { getSupabase } from '@/lib/supabase-client';
import { invoiceSchema } from '@/lib/validation';
import { generateZatcaQRData, validateInvoiceForZatca } from '@/lib/zatca';

const sb = () => getSupabase();

/**
 * GET /api/invoices
 * جلب جميع الفواتير
 */
export async function GET(request: NextRequest) {
  try {
    const auth = await requireModulePermission(request, 'invoices', 'read');
    const s = sb();
    const url = request.nextUrl;
    const page = Math.max(1, parseInt(url.searchParams.get('page') || '1', 10) || 1);
    const pageSize = Math.min(500, Math.max(1, parseInt(url.searchParams.get('pageSize') || '50', 10) || 50));
    const status = url.searchParams.get('status');
    const clientId = url.searchParams.get('client_id');
    const dateFrom = url.searchParams.get('from');
    const dateTo = url.searchParams.get('to');

    let query = s.from('invoices')
      .select('id, number, contact_id, project_id, date, due_date, subtotal, vat_rate, vat_amount, total, status, notes, journal_entry_id, zatca_qr, created_at, contacts(name)', { count: 'exact' })
      .eq('company_id', auth.companyId)
      .is('deleted_at', null);
    if (status) query = query.eq('status', status);
    if (clientId) query = query.eq('contact_id', clientId);
    if (dateFrom) query = query.gte('date', dateFrom);
    if (dateTo) query = query.lte('date', dateTo);

    const offset = (page - 1) * pageSize;
    const { data, error: queryError, count } = await query
      .order('date', { ascending: false }).order('number', { ascending: false })
      .range(offset, offset + pageSize - 1);

    if (queryError) {
      // Schema-drift resilience: if a column (e.g. deleted_at / zatca_qr /
      // journal_entry_id) or the contacts embed is missing in the DB, PostgREST
      // 500s the whole page. Retry with a guaranteed-safe minimal select and
      // resolve client names in a separate query instead of locking the user out.
      const em = `${queryError.message || ''} ${queryError.details || ''} ${queryError.hint || ''} ${queryError.code || ''}`;
      const schemaDrift = /column|relationship|could not find|does not exist|PGRST|42P01|42703/i.test(em);
      if (!schemaDrift) throw queryError;
      console.error('[invoices] primary query failed (schema drift?), retrying minimal select:', em);

      let fallback = s.from('invoices')
        .select('id, number, contact_id, date, due_date, subtotal, vat_rate, vat_amount, total, status, notes, created_at', { count: 'exact' })
        .eq('company_id', auth.companyId);
      if (status) fallback = fallback.eq('status', status);
      if (clientId) fallback = fallback.eq('contact_id', clientId);
      if (dateFrom) fallback = fallback.gte('date', dateFrom);
      if (dateTo) fallback = fallback.lte('date', dateTo);

      const { data: fData, error: fErr, count: fCount } = await fallback
        .order('date', { ascending: false }).order('number', { ascending: false })
        .range(offset, offset + pageSize - 1);
      if (fErr) throw fErr;

      const contactIds = [...new Set((fData || []).map((i: any) => i.contact_id).filter(Boolean))] as string[];
      const names: Record<string, string> = {};
      if (contactIds.length > 0) {
        const { data: cs } = await s.from('contacts').select('id, name').in('id', contactIds).eq('company_id', auth.companyId);
        for (const c of cs || []) names[(c as any).id] = (c as any).name;
      }
      const invoices = (fData || []).map((i: any) => ({ ...i, client_name: names[i.contact_id] || '' }));
      return success({ invoices, total: fCount || 0, page, pageSize, totalPages: Math.ceil((fCount || 0) / pageSize) || 1 });
    }

    const invoices = (data || []).map((i: any) => ({
      ...i, client_name: i.contacts?.name || '',
    }));

    return success({ invoices, total: count || 0, page, pageSize, totalPages: Math.ceil((count || 0) / pageSize) || 1 });
  } catch (err) {
    return handleApiError(err);
  }
}

/**
 * POST /api/invoices
 * إنشاء فاتورة جديدة
 * FIXED: يدعم ميزة "البيع النقدي المباشر مع التحصيل الفوري للفاتورة وإنشاء سند القبض وترحيل القيد المتزن في معاملة ذرية واحدة"
 */
export async function POST(request: NextRequest) {
  try {
    const auth = await requireModulePermission(request, 'invoices', 'create');
    const s = sb();

    // التحقق من حدود باقة الفواتير للشركة
    try {
      const { checkUsageLimit } = await import('@/lib/usage-limits');
      const limitCheck = await checkUsageLimit(auth.companyId, 'invoices');
      if (!limitCheck.allowed) {
        return error(limitCheck.message || 'تم الوصول للحد الأقصى للفواتير المسموحة في باقتك', 403);
      }
    } catch (e) {
      console.error('Usage limit check failed for invoices:', e);
      // A failed entitlement lookup must not silently permit billable document
      // creation in production. Development remains usable without the table.
      if (process.env.NODE_ENV === 'production') {
        return error('تعذر التحقق من حد الفواتير. حاول لاحقاً', 503);
      }
    }

    const body = await parseBody(request);

    // استخلاص حقول التحصيل النقدي الفوري المسبق لتلافي تعطل الـ Zod Schema Strict
    const collectedAmount = Number(body.collected_amount || body.collectedAmount || 0);
    const bankSafeId = body.bank_safe_id || body.bankSafeId || null;

    const bodyToValidate = { ...body };
    delete bodyToValidate.collected_amount;
    delete bodyToValidate.collectedAmount;
    delete bodyToValidate.bank_safe_id;
    delete bodyToValidate.bankSafeId;
    delete bodyToValidate.payment_method;
    delete bodyToValidate.paymentMethod;

    const parsed = invoiceSchema.safeParse(bodyToValidate);
    if (!parsed.success) return error(parsed.error.issues[0].message);

    const { clientId, projectId, date, dueDate, items, vatRate, notes, vatEnabled } = parsed.data;
    if (!Number.isFinite(collectedAmount) || collectedAmount < 0
      || Math.abs(collectedAmount * 100 - Math.round(collectedAmount * 100)) > 1e-8) {
      return error('مبلغ التحصيل غير صالح');
    }

    // Numbering, tenant checks, server-side totals, invoice/items, sales
    // journal and optional immediate receipt/allocation commit together.
    const { data: created, error: createError } = await s.rpc('create_sales_invoice_atomic', {
      p_company_id: auth.companyId,
      p_contact_id: clientId,
      p_project_id: projectId || null,
      p_date: date,
      p_due_date: dueDate,
      p_items: items,
      p_vat_rate: vatRate,
      p_vat_enabled: vatEnabled,
      p_notes: notes || '',
      p_collected_amount: collectedAmount,
      p_bank_safe_id: bankSafeId,
      p_user_id: auth.userId,
    });
    if (createError) throw createError;
    const invoice = created as Record<string, any>;

    const { data: itemsRes, error: itemsError } = await s.from('invoice_items')
      .select('id, description, quantity, unit_price, total')
      .eq('invoice_id', invoice.id)
      .eq('company_id', auth.companyId);
    if (itemsError) throw itemsError;

    // QR generation is a non-authoritative presentation artifact. Financial
    // creation remains committed even when seller tax metadata is incomplete.
    let zatcaQRData: string | null = null;
    try {
      const { data: company, error: companyError } = await s.from('companies')
        .select('name, tax_number').eq('id', auth.companyId).maybeSingle();
      if (companyError) throw companyError;
      const sellerName = (company as { name?: string } | null)?.name || '';
      const vatNumber = (company as { tax_number?: string } | null)?.tax_number || '';
      if (sellerName && /^\d{15}$/.test(vatNumber)) {
        const qrPayload = {
          sellerName,
          vatNumber,
          timestamp: new Date(date).toISOString(),
          invoiceTotal: Number(invoice.total),
          vatTotal: Number(invoice.vat_amount || 0),
        };
        if (validateInvoiceForZatca(qrPayload).valid) {
          zatcaQRData = generateZatcaQRData(qrPayload);
          const { error: qrError } = await s.from('invoices')
            .update({ zatca_qr: zatcaQRData })
            .eq('id', invoice.id).eq('company_id', auth.companyId);
          if (qrError) throw qrError;
        }
      }
    } catch (zatcaErr) {
      console.warn('ZATCA QR generation bypassed:', zatcaErr);
    }

    return success({
      ...invoice,
      items: itemsRes || [],
      journalEntryId: invoice.journal_entry_id,
      voucherReceiptId: invoice.voucher_receipt_id,
      zatcaQRData,
    }, 201);
  } catch (err) {
    return handleApiError(err);
  }
}
