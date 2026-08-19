import { NextRequest } from 'next/server';
import { success, error, parseBody, requireModulePermission, handleApiError } from '@/lib/api-helpers';
import { getSupabase } from '@/lib/supabase-client';
import { invoiceSchema } from '@/lib/validation';
import { generateZatcaQRData, validateInvoiceForZatca } from '@/lib/zatca';
import { isValidDate } from '@/lib/utils';
import { assertOpenFiscalPeriod } from '@/lib/fiscal-guard';

const sb = () => getSupabase();
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const INVOICE_STATUSES = new Set(['unpaid', 'partial', 'paid', 'cancelled']);

/** GET /api/invoices - tenant-scoped invoice list. */
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
    if (status && !INVOICE_STATUSES.has(status)) return error('حالة الفاتورة غير صالحة');
    if (clientId && !UUID_RE.test(clientId)) return error('معرّف العميل غير صالح');
    if ((dateFrom && !isValidDate(dateFrom)) || (dateTo && !isValidDate(dateTo))
      || (dateFrom && dateTo && dateFrom > dateTo)) return error('فترة الفواتير غير صالحة');

    let query = s.from('invoices')
      .select('id, number, contact_id, project_id, date, due_date, subtotal, vat_rate, vat_amount, total, status, notes, journal_entry_id, zatca_qr, created_at', { count: 'exact' })
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
    if (queryError) throw queryError;

    const contactIds = [...new Set((data || []).map((invoice: any) => invoice.contact_id).filter(Boolean))] as string[];
    const contactNames: Record<string, string> = {};
    if (contactIds.length) {
      const { data: contacts, error: contactsError } = await s.from('contacts')
        .select('id, name').eq('company_id', auth.companyId).in('id', contactIds);
      if (contactsError) throw contactsError;
      for (const contact of contacts || []) contactNames[(contact as any).id] = (contact as any).name;
    }
    const invoices = (data || []).map((invoice: any) => ({
      ...invoice,
      client_name: contactNames[invoice.contact_id] || '',
    }));
    return success({
      invoices,
      total: count || 0,
      page,
      pageSize,
      totalPages: Math.ceil((count || 0) / pageSize) || 1,
    });
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

    // Return the actual accounting reason to the user instead of allowing the
    // database trigger to surface as a generic production server error.
    await assertOpenFiscalPeriod(auth.companyId, date);

    // TAX CONTROL: the VAT rate is a tax-compliance setting, not a free-form
    // field. Only the company admin may override it; everyone else must use
    // the company's configured rate (or 0 for zero-rated invoices such as
    // exports). This closes the "any invoice creator can issue 0%/odd-rate
    // invoices" loophole flagged in the security audit.
    if (auth.role !== 'admin' && vatEnabled !== false) {
      try {
        const { data: companyRow } = await s.from('companies')
          .select('vat_rate').eq('id', auth.companyId).maybeSingle();
        const companyVatRate = Number((companyRow as Record<string, any> | null)?.vat_rate);
        const configured = Number.isFinite(companyVatRate) && companyVatRate > 0 && companyVatRate <= 1
          ? companyVatRate : 0.15;
        const allowedRates = [0, configured];
        if (!allowedRates.includes(vatRate)) {
          return error(
            `نسبة الضريبة يجب أن تطابق إعدادات الشركة (${(configured * 100).toFixed(0)}%) أو 0% للفواتير المعفاة. تواصل مع مدير النظام لتغيير النسبة.`,
            403
          );
        }
      } catch (e) {
        // Fail closed on unreadable company settings in production.
        if (process.env.NODE_ENV === 'production') {
          console.error('[invoices] could not verify company VAT rate:', e);
          return error('تعذر التحقق من إعدادات الضريبة. حاول لاحقاً', 503);
        }
      }
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
      const taxSnapshot = invoice.tax_snapshot as Record<string, any> | undefined;
      const seller = taxSnapshot?.seller as Record<string, any> | undefined;
      const sellerName = typeof seller?.name === 'string' ? seller.name.trim() : '';
      const vatNumber = typeof seller?.vat_number === 'string' ? seller.vat_number.trim() : '';
      const createdAt = new Date(String(invoice.created_at));
      if (sellerName && /^\d{15}$/.test(vatNumber) && Number.isFinite(createdAt.getTime())) {
        const qrPayload = {
          sellerName,
          vatNumber,
          timestamp: `${date}T${createdAt.toISOString().slice(11, 19)}Z`,
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
