import { NextRequest } from 'next/server';
import { success, error, parseBody, requireApiAuth, requireModulePermission, handleApiError } from '@/lib/api-helpers';
import { getSupabase } from '@/lib/supabase-client';
import { invoiceSchema } from '@/lib/validation';
import { generateZatcaQRData, validateInvoiceForZatca } from '@/lib/zatca';
import { getNextVoucherNumber, getNextJournalNumber } from '@/lib/numbering';
import { insertJournalLines } from '@/lib/journal-utils';
import { generateId } from '@/lib/utils';

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

    const { clientId, projectId, date, dueDate, items, vatRate, notes, vatEnabled } = parsed.data;
    const year = date.substring(0, 4);

    // TENANT CHECKS: client (and optional project) must belong to this company
    const { data: contact } = await s.from('contacts').select('id')
      .eq('id', clientId).eq('company_id', auth.companyId).maybeSingle();
    if (!contact) return error('العميل غير موجود', 404);
    if (projectId) {
      const { data: project } = await s.from('projects').select('id')
        .eq('id', projectId).eq('company_id', auth.companyId).maybeSingle();
      if (!project) return error('المشروع غير موجود', 404);
    }

    // ACCOUNTING INTEGRITY: all amounts recomputed server-side. Client-sent
    // subtotal/vatAmount/total are ignored (UI hints only) — trusting them
    // previously allowed VAT-understated invoices and forged ZATCA totals.
    const round2 = (n: number) => Math.round((n + Number.EPSILON) * 100) / 100;
    const computedItems = items.map((it) => {
      const gross = round2(it.quantity * it.unitPrice);
      const discount = Math.min(round2(it.discount || 0), gross);
      return { ...it, discount, total: round2(gross - discount) };
    });
    const subtotal = round2(computedItems.reduce((sum, it) => sum + it.total, 0));
    const computedVat = vatEnabled === false ? 0 : round2(subtotal * vatRate);
    const computedTotal = round2(subtotal + computedVat);

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

    // حساب الحالة والمدفوع بناء على التحصيل النقدي المباشر
    const finalPaidAmount = collectedAmount > 0 ? Math.min(collectedAmount, computedTotal) : 0;
    const finalStatus = finalPaidAmount === 0 ? 'unpaid' : (finalPaidAmount >= computedTotal ? 'paid' : 'partial');

    let invoiceId: string | null = null;
    let journalEntryId: string | null = null;
    let voucherReceiptId: string | null = null;

    // Pre-validate the collection bank/safe BEFORE creating anything —
    // an invalid/foreign id must 400 here, not trigger a rollback later.
    let collectionBankSafe: { id: string; account_id: string | null } | null = null;
    if (finalPaidAmount > 0 && bankSafeId) {
      const { data: bs } = await s.from('banks_safes')
        .select('id, account_id')
        .eq('id', bankSafeId).eq('company_id', auth.companyId).maybeSingle();
      if (!bs) return error('الخزينة/البنك المحدد غير موجود');
      collectionBankSafe = bs as { id: string; account_id: string | null };
    }

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

      // 2. إدخال البنود (بقيم محسوبة خادمياً شاملة الخصم)
      for (const item of computedItems) {
        const { error: itemErr } = await s.from('invoice_items').insert({
          company_id: auth.companyId,
          invoice_id: invoiceId,
          description: item.description,
          quantity: item.quantity,
          unit_price: item.unitPrice,
          total: item.total,
        });
        if (itemErr) throw itemErr;
      }

      // 3. جلب الحسابات المحاسبية الأساسية للترحيل المزدوج (مع التوليد التلقائي عند غيابها)
      let { data: arAccount } = await s.from('accounts').select('id').eq('company_id', auth.companyId).eq('code', '1130').maybeSingle();
      let { data: revenueAccount } = await s.from('accounts').select('id').eq('company_id', auth.companyId).eq('code', '4100').maybeSingle();
      let { data: vatAccount } = await s.from('accounts').select('id').eq('company_id', auth.companyId).eq('code', '2120').maybeSingle();

      if (!arAccount || !revenueAccount) {
        const { createDefaultChartOfAccounts } = await import('@/lib/default-accounts');
        await createDefaultChartOfAccounts(s, auth.companyId);

        arAccount = (await s.from('accounts').select('id').eq('company_id', auth.companyId).eq('code', '1130').maybeSingle()).data;
        revenueAccount = (await s.from('accounts').select('id').eq('company_id', auth.companyId).eq('code', '4100').maybeSingle()).data;
        vatAccount = (await s.from('accounts').select('id').eq('company_id', auth.companyId).eq('code', '2120').maybeSingle()).data;
      }

      if (!arAccount || !revenueAccount) {
        throw new Error('الحسابات الأساسية للترحيل مفقودة وتعذر إنشاء دليل الحسابات الافتراضي تلقائياً.');
      }

      // 4. إنشاء قيد اليومية العام للفاتورة
      // Journal entries get their OWN sequence — previously the invoice
      // number was reused, colliding with the manual journal sequence.
      const journalNumber = await getNextJournalNumber(auth.companyId, date);
      const { data: jeRes, error: jeErr } = await s.from('journal_entries')
        .insert({
          company_id: auth.companyId,
          number: journalNumber,
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

      // إذا وُجد تحصيل نقدي فوري مسبق (تم التحقق من انتمائه للشركة قبل الإنشاء)
      if (finalPaidAmount > 0 && bankSafeId && collectionBankSafe) {
        if (collectionBankSafe.account_id) {
          // مدين 1: البنك/الخزينة المودع بها المبلغ
          journalLines.push({
            journal_entry_id: journalEntryId,
            account_id: collectionBankSafe.account_id,
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
        // مدين 2: ذمم العملاء المدينة (المتبقي الآجل) — موسوم بـ contact_id
        // ليدخل في رصيد العميل (الآجل المستحق عليه)
        journalLines.push({
          journal_entry_id: journalEntryId,
          account_id: arAccount.id,
          debit: remainingReceivable,
          credit: 0,
          contact_id: clientId,
          description: `المتبقي الآجل للفاتورة رقم ${number}`
        });
      }

      // دائن 1: إيرادات مقاولات (قيمة المبيعات قبل الضريبة)
      journalLines.push({
        journal_entry_id: journalEntryId,
        account_id: revenueAccount.id,
        debit: 0,
        credit: subtotal,
        description: `إيراد فاتورة مبيعات رقم ${number}`
      });

      // دائن 2: ضريبة المبيعات المضافة 15% (إن وُجدت)
      if (computedVat > 0 && vatAccount) {
        journalLines.push({
          journal_entry_id: journalEntryId,
          account_id: vatAccount.id,
          debit: 0,
          credit: computedVat,
          description: `ضريبة فاتورة رقم ${number}`
        });
      }

      // إدراج السطور وترحيل القيد للدفاتر — عبر insertJournalLines التي تفرض
      // company_id للسطور وتحلّل كود/اسم الحساب ضمن الشركة نفسها فقط
      const { error: linesErr } = await insertJournalLines(auth.companyId, journalLines);
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
          await s.from('journal_entries').delete().eq('id', journalEntryId).eq('company_id', auth.companyId);
        }
        if (invoiceId) {
          await s.from('invoice_items').delete().eq('invoice_id', invoiceId);
          await s.from('invoices').delete().eq('id', invoiceId).eq('company_id', auth.companyId);
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
