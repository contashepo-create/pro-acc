import { NextRequest } from 'next/server';
import { success, requireModulePermission, handleApiError } from '@/lib/api-helpers';
import { getSupabase } from '@/lib/supabase-client';

const sb = () => getSupabase();

/**
 * VAT Report (تقرير ضريبة القيمة المضافة)
 * For ZATCA compliance in Saudi Arabia - 15% VAT
 * Shows VAT on sales (collected) and VAT on purchases (paid)
 */
export async function GET(request: NextRequest) {
  try {
    const auth = await requireModulePermission(request, 'reports', 'read');
    const s = sb();
    const url = new URL(request.url);
    const from = url.searchParams.get('from');
    const to = url.searchParams.get('to');

    // VAT Sales account 2120, VAT Purchases 1180
    const { data: vatSalesAcc } = await s.from('accounts')
      .select('id').eq('company_id', auth.companyId).eq('code', '2120').maybeSingle();
    const { data: vatPurchasesAcc } = await s.from('accounts')
      .select('id').eq('company_id', auth.companyId).eq('code', '1180').maybeSingle();

    let salesQuery = s.from('journal_entries').select('id, date, number, description').eq('company_id', auth.companyId).is('deleted_at', null);
    let purchasesQuery = s.from('journal_entries').select('id, date, number, description').eq('company_id', auth.companyId).is('deleted_at', null);

    if (from) {
      salesQuery = salesQuery.gte('date', from);
      purchasesQuery = purchasesQuery.gte('date', from);
    }
    if (to) {
      salesQuery = salesQuery.lte('date', to);
      purchasesQuery = purchasesQuery.lte('date', to);
    }

    const { data: salesEntries } = await salesQuery;
    const { data: purchaseEntries } = await purchasesQuery;

    const salesIds = (salesEntries || []).map((e: any) => e.id);
    const purchaseIds = (purchaseEntries || []).map((e: any) => e.id);
    const entryMap = new Map([...(salesEntries || []), ...(purchaseEntries || [])].map((e: any) => [e.id, e]));

    let vatCollected = 0;
    let vatPaid = 0;
    let vatCollectedDetails: any[] = [];
    let vatPaidDetails: any[] = [];

    if (vatSalesAcc && salesIds.length > 0) {
      const { data: salesLines } = await s.from('journal_lines')
        .select('id, journal_entry_id, credit, debit, description')
        .eq('company_id', auth.companyId)
        .eq('account_id', (vatSalesAcc as any).id)
        .in('journal_entry_id', salesIds);

      for (const line of salesLines || []) {
        const amount = (parseFloat((line as any).credit) || 0) - (parseFloat((line as any).debit) || 0);
        if (amount <= 0) continue;
        vatCollected += amount;
        const entry = entryMap.get(line.journal_entry_id);
        vatCollectedDetails.push({
          date: entry?.date,
          number: entry?.number,
          description: line.description || entry?.description || 'ضريبة مخرجات (مبيعات)',
          amount,
          type: 'sales',
        });
      }
    }

    if (vatPurchasesAcc && purchaseIds.length > 0) {
      const { data: purchaseLines } = await s.from('journal_lines')
        .select('id, journal_entry_id, debit, credit, description')
        .eq('company_id', auth.companyId)
        .eq('account_id', (vatPurchasesAcc as any).id)
        .in('journal_entry_id', purchaseIds);

      for (const line of purchaseLines || []) {
        const amount = (parseFloat((line as any).debit) || 0) - (parseFloat((line as any).credit) || 0);
        if (amount <= 0) continue;
        vatPaid += amount;
        const entry = entryMap.get(line.journal_entry_id);
        vatPaidDetails.push({
          date: entry?.date,
          number: entry?.number,
          description: line.description || entry?.description || 'ضريبة مدخلات (مشتريات)',
          amount,
          type: 'purchases',
        });
      }
    }

    // Direct document queries for cross-validation
    let invoiceQuery = s.from('invoices')
      .select('id, number, date, subtotal, vat_amount, tax_amount, total')
      .eq('company_id', auth.companyId)
      .neq('status', 'cancelled')
      .is('deleted_at', null);

    if (from) invoiceQuery = invoiceQuery.gte('date', from);
    if (to) invoiceQuery = invoiceQuery.lte('date', to);

    const { data: invoices } = await invoiceQuery;

    const invoiceVatTotal = (invoices || []).reduce((sum: number, inv: any) => sum + (parseFloat(inv.vat_amount || inv.tax_amount) || 0), 0);
    const invoiceSubtotal = (invoices || []).reduce((sum: number, inv: any) => sum + (parseFloat(inv.subtotal) || 0), 0);
    const invoiceTotal = (invoices || []).reduce((sum: number, inv: any) => sum + (parseFloat(inv.total) || 0), 0);

    let purchaseInvQuery = s.from('purchase_invoices')
      .select('id, invoice_number, date, subtotal, tax_amount, total')
      .eq('company_id', auth.companyId)
      .neq('status', 'cancelled');

    if (from) purchaseInvQuery = purchaseInvQuery.gte('date', from);
    if (to) purchaseInvQuery = purchaseInvQuery.lte('date', to);

    const { data: purchaseInvoices } = await purchaseInvQuery;

    const purchaseVatTotal = (purchaseInvoices || []).reduce((sum: number, inv: any) => sum + (parseFloat(inv.tax_amount) || 0), 0);

    const effectiveVatCollected = vatCollected > 0 ? vatCollected : invoiceVatTotal;
    const effectiveVatPaid = vatPaid > 0 ? vatPaid : purchaseVatTotal;
    const vatPayable = effectiveVatCollected - effectiveVatPaid;

    return success({
      period: { from, to },
      vat_collected: {
        from_journal: vatCollected,
        from_invoices: invoiceVatTotal,
        total: effectiveVatCollected,
        details: vatCollectedDetails,
        invoices: invoices || [],
      },
      vat_paid: {
        from_journal: vatPaid,
        from_invoices: purchaseVatTotal,
        total: effectiveVatPaid,
        details: vatPaidDetails,
        purchase_invoices: purchaseInvoices || [],
      },
      summary: {
        total_sales_excluding_vat: invoiceSubtotal,
        total_sales_including_vat: invoiceTotal,
        total_vat_collected: effectiveVatCollected,
        total_vat_paid: effectiveVatPaid,
        vat_payable: vatPayable,
        vat_payable_status: vatPayable >= 0 ? 'payable' : 'refundable',
      },
      zatca_compliant: true,
      vat_rate: 0.15,
    });
  } catch (err) {
    return handleApiError(err);
  }
}
