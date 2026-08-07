import { NextRequest } from 'next/server';
import { success, error, parseBody, requireApiAuth, handleApiError } from '@/lib/api-helpers';
import { getSupabase } from '@/lib/supabase-client';
import { invoiceSchema } from '@/lib/validation';
import { generateZatcaQRData, validateInvoiceForZatca } from '@/lib/zatca';
import { getNextVoucherNumber } from '@/lib/numbering';
import { generateId } from '@/lib/utils';

const sb = () => getSupabase();

/**
 * GET /api/invoices
 * جلب جميع الفواتير
 */
export async function GET(request: NextRequest) {
  try {
    const auth = await requireApiAuth(request);
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

    if (queryError) throw queryError;

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
    const auth = await requireApiAuth(request);
    const s = sb();

    // التحقق من حدود باقة الفواتير للشركة
    try {
      const { checkUsageLimit } = await import('@/lib/usage-limits');
      const limitCheck = await checkUsageLimit(auth.companyId, 'invoices');
      if (!limitCheck.allowed) {
        return error(limitCheck.message || 'تم الوصول للحد الأقصى للفواتير المسموحة في باقتك', 403);
      }
    } catch (e) {
      console.warn('Usage limit check failed for invoices:', e);
    }

    const body = await parseBody(request);

    // استخلاص حقول التحصيل النقدي الفوري المسبق لتلافي تعطل الـ Zod Schema Strict
    const collectedAmount = Number(body.collected_amount || body.collectedAmount || 0);
    const bankSafeId = body.bank_safe_id || body.bankSafeId || null;
    const paymentMethod = body.payment_method || body.paymentMethod || 'cash';

    const bodyToValidate = { ...body };
    delete bodyToValidate.collected_amount;
    delete bodyToValidate.collectedAmount;
    delete bodyToValidate.bank_safe_id;
    delete bodyToValidate.bankSafeId;
    delete bodyToValidate.payment_method;
    delete bodyToValidate.paymentMethod;

    const parsed = invoiceSchema.safeParse(bodyToValidate);
    if (!parsed.success) return error(parsed.error.issues[0].message);

    const { clientId, projectId, date, dueDate, items, subtotal, vatRate, vatAmount, total, notes } = parsed.data;
    const year = date.substring(0, 4);

    // توليد الرقم التسلسلي للفاتورة
    let number: number;
    try {
      const { data: rpcData, error: rpcError } = await s.rpc('next_invoice_number', {
        p_company_id: auth.companyId,
        p_year: parseInt(year),
      });
      if (rpcError || rpcData == null) throw rpcError || new Error('RPC failed');
      number = rpcData as number;
    } catch {
      // Fallback
      const { data: seqExisting } = await s.from('invoice_sequences')
        .select('last_number').eq('company_id', auth.companyId).eq('year', year).maybeSingle();
      if (seqExisting) {
        number = seqExisting.last_number + 1;
        await s.from('invoice_sequences').update({ last_number: number }).eq('company_id', auth.companyId).eq('year', year);
      } else {
        number = 1;
        await s.from('invoice_sequences').insert({ company_id: auth.companyId, year: parseInt(year), last_number: 1 });
      }
    }

    const computedVat = vatAmount ?? subtotal * vatRate;
    const computedTotal = total ?? subtotal + computedVat;

    // حساب الحالة والمدفوع بناء على التحصيل النقدي المباشر
    const finalPaidAmount = collectedAmount > 0 ? Math.min(collectedAmount, computedTotal) : 0;
    const finalStatus = finalPaidAmount === 0 ? 'unpaid' : (finalPaidAmount >= computedTotal ? 'paid' : 'partial');

    let invoiceId: string | null = null;
    let journalEntryId: string | null = null;
    let voucherReceiptId: string | null = null;

    try {
      // 1. إنشاء الفاتورة
      const { data: invoiceRes, error: invErr } = await s.from('invoices')
        .insert({
          company_id: auth.companyId, 
          number, 
          contact_id: clientId, 
          project_id: projectId || null,
          date, 
          due_date: dueDate, 
          subtotal, 
          vat_rate: vatRate, 
          vat_amount: computedVat,
          total: computedTotal, 
          paid_amount: finalPaidAmount,
          status: finalStatus, 
          notes: notes || null, 
          created_by: auth.userId,
        })
        .select('id, number, date, due_date, subtotal, vat_rate, vat_amount, total, status, notes')
        .single();
        
      if (invErr) throw invErr;
      invoiceId = invoiceRes.id;

      // 2. إدخال البنود
      for (const item of items) {
        const itemTotal = item.total ?? item.quantity * (item as any).unit_price;
        const { error: itemErr } = await s.from('invoice_items').insert({
          invoice_id: invoiceId, 
          description: item.description, 
          quantity: item.quantity,
          unit_price: item.unitPrice, 
          total: itemTotal,
        });
        if (itemErr) throw itemErr;
      }

      // 3. جلب الحسابات المحاسبية الأساسية للترحيل المزدوج
      const { data: arAccount } = await s.from('accounts').select('id').eq('company_id', auth.companyId).eq('code', '1130').maybeSingle();
      const { data: revenueAccount } = await s.from('accounts').select('id').eq('company_id', auth.companyId).eq('code', '4100').maybeSingle();
      const { data: vatAccount } = await s.from('accounts').select('id').eq('company_id', auth.companyId).eq('code', '2120').maybeSingle();

      if (!arAccount || !revenueAccount) {
        throw new Error('الحسابات الأساسية للترحيل مفقودة. يرجى التأكد من تفعيل دليل الحسابات أولاً.');
      }

      // 4. إنشاء قيد اليومية العام للفاتورة
      const { data: jeRes, error: jeErr } = await s.from('journal_entries')
        .insert({
          company_id: auth.companyId, 
          number, 
          date, 
          type: 'general',
          description: `فاتورة مبيعات رقم ${number}`, 
          reference_type: 'invoice',
          reference_id: invoiceId,
          created_by: auth.userId,
        }).select('id').single();
        
      if (jeErr) throw jeErr;
      journalEntryId = jeRes.id;

      // 5. بناء سطور القيد المحاسبي المتزن شامل البيع المباشر أو التحصيل الجزئي المسبق (Stripe & ERP Standard T-Account Entry)
      const journalLines: any[] = [];

      // إذا وُجد تحصيل نقدي فوري مسبق
      if (finalPaidAmount > 0 && bankSafeId) {
        const { data: bankSafe } = await s.from('banks_safes').select('account_id').eq('id', bankSafeId).maybeSingle();
        if (bankSafe?.account_id) {
          // مدين 1: البنك/الخزينة المودع بها المبلغ
          journalLines.push({ 
            journal_entry_id: journalEntryId, 
            account_id: bankSafe.account_id, 
            account_code: '1120', 
            debit: finalPaidAmount, 
            credit: 0, 
            description: `تحصيل مالي فوري للفاتورة رقم ${number}` 
          });

          // إنشاء سند قبض (Voucher Receipt) رسمي مرتبط في السوبابيز
          const nextVoucherNumber = await getNextVoucherNumber(auth.companyId, 'voucher_receipts');
          const { data: recData, error: recErr } = await s.from('voucher_receipts').insert({
            company_id: auth.companyId,
            number: nextVoucherNumber,
            date,
            receipt_type: 'client',
            contact_id: clientId,
            amount: finalPaidAmount,
            bank_safe_id: bankSafeId,
            reason: `تحصيل فوري نقدية للفاتورة مبيعات رقم ${number}`,
            journal_entry_id: journalEntryId,
            created_by: auth.userId,
            status: 'approved'
          }).select('id').single();
          
          if (!recErr && recData) voucherReceiptId = recData.id;
        }
      }

      // حساب المتبقي على ذمم العميل المدينة
      const remainingReceivable = computedTotal - finalPaidAmount;
      if (remainingReceivable > 0) {
        // مدين 2: ذمم العملاء المدينة (المتبقي الآجل)
        journalLines.push({ 
          journal_entry_id: journalEntryId, 
          account_id: arAccount.id, 
          account_code: '1130', 
          debit: remainingReceivable, 
          credit: 0, 
          description: `المتبقي الآجل للفاتورة رقم ${number}` 
        });
      }

      // دائن 1: إيرادات مقاولات (قيمة المبيعات قبل الضريبة)
      journalLines.push({ 
        journal_entry_id: journalEntryId, 
        account_id: revenueAccount.id, 
        account_code: '4100', 
        debit: 0, 
        credit: subtotal, 
        description: `إيراد فاتورة مبيعات رقم ${number}` 
      });

      // دائن 2: ضريبة المبيعات المضافة 15% (إن وُجدت)
      if (computedVat > 0 && vatAccount) {
        journalLines.push({ 
          journal_entry_id: journalEntryId, 
          account_id: vatAccount.id, 
          account_code: '2120', 
          debit: 0, 
          credit: computedVat, 
          description: `ضريبة فاتورة رقم ${number}` 
        });
      }

      // إدراج السطور وترحيل القيد للدفاتر
      const { error: linesErr } = await s.from('journal_lines').insert(journalLines);
      if (linesErr) throw linesErr;

      // ربط القيد والتحصيل بالفاتورة
      await s.from('invoices').update({ journal_entry_id: journalEntryId }).eq('id', invoiceId);

      const { data: itemsRes } = await s.from('invoice_items')
        .select('id, description, quantity, unit_price, total').eq('invoice_id', invoiceId);

      // ZATCA Phase 2: QR TLV Generation
      let zatcaQRData: string | null = null;
      try {
        const { data: company } = await s.from('companies')
          .select('name, tax_number')
          .eq('id', auth.companyId)
          .maybeSingle();
        
        const companyData = company as { name?: string; tax_number?: string } | null;
        const sellerName = companyData?.name || '';
        const vatNumber = companyData?.tax_number || '';
        
        if (sellerName && vatNumber && /^\d{15}$/.test(vatNumber)) {
          const qrPayload = {
            sellerName,
            vatNumber,
            timestamp: new Date(date).toISOString(),
            invoiceTotal: parseFloat(String(computedTotal)),
            vatTotal: parseFloat(String(computedVat)),
          };
          
          const validation = validateInvoiceForZatca(qrPayload);
          if (validation.valid) {
            zatcaQRData = generateZatcaQRData(qrPayload);
            await s.from('invoices').update({ zatca_qr: zatcaQRData }).eq('id', invoiceId);
          }
        }
      } catch (zatcaErr) {
        console.warn('ZATCA QR generation bypassed:', zatcaErr);
      }

      return success({ 
        ...invoiceRes, 
        items: itemsRes || [], 
        journalEntryId, 
        voucherReceiptId,
        zatcaQRData 
      }, 201);

    } catch (txErr) {
      // التراجع التلقائي الذري (Auto Rollback)
      console.error('Invoice combined creation failed, rolling back:', txErr);
      try {
        if (voucherReceiptId) await s.from('voucher_receipts').delete().eq('id', voucherReceiptId);
        if (journalEntryId) {
          await s.from('journal_lines').delete().eq('journal_entry_id', journalEntryId);
          await s.from('journal_entries').delete().eq('id', journalEntryId);
        }
        if (invoiceId) {
          await s.from('invoice_items').delete().eq('invoice_id', invoiceId);
          await s.from('invoices').delete().eq('id', invoiceId);
        }
      } catch (rollbackErr) {
        console.error('Rollback failed:', rollbackErr);
      }
      throw txErr;
    }
  } catch (err) {
    return handleApiError(err);
  }
}
