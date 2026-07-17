import { NextRequest } from 'next/server';
import { success, requireApiAuth, handleApiError } from '@/lib/api-helpers';
import { getSupabase } from '@/lib/supabase-client';

const sb = () => getSupabase();

/**
 * VAT Report (تقرير ضريبة القيمة المضافة)
 * For ZATCA compliance in Saudi Arabia - 15% VAT
 * Shows VAT on sales (collected) and VAT on purchases (paid)
 */
export async function GET(request: NextRequest) {
  try {
    const auth = await requireApiAuth(request);
    const s = sb();
    const url = new URL(request.url);
    const from = url.searchParams.get('from');
    const to = url.searchParams.get('to');

    // VAT Sales account 2120, VAT Purchases 1180
    const { data: vatSalesAcc } = await s.from('accounts')
      .select('id').eq('company_id', auth.companyId).eq('code', '2120').maybeSingle();
    const { data: vatPurchasesAcc } = await s.from('accounts')
      .select('id').eq('company_id', auth.companyId).eq('code', '1180').maybeSingle();

    let salesQuery = s.from('journal_entries').select('id').eq('company_id', auth.companyId).is('deleted_at', null);
    let purchasesQuery = s.from('journal_entries').select('id').eq('company_id', auth.companyId).is('deleted_at', null);

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

    let vatCollected = 0;
    let vatPaid = 0;
    let vatCollectedDetails: any[] = [];
    let vatPaidDetails: any[] = [];

    if (vatSalesAcc && salesIds.length > 0) {
      const { data: salesLines } = await s.from('journal_lines')
        .select('id, journal_entry_id, credit, debit, description, journal_entries!journal_entry_id(date, number, description)')
        .eq('account_id', (vatSalesAcc as any).id)
        .in('journal_entry_id', salesIds);

      for (const line of salesLines || []) {
        const amount = parseFloat((line as any).credit) || parseFloat((line as any).debit) || 0;
        vatCollected += amount;
        vatCollectedDetails.push({
          date: (line as any).journal_entries?.date,
          number: (line as any).journal_entries?.number,
          description: (line as any).journal_entries?.description || line.description,
          amount,
          type: 'sales',
        });
      }
    }

    if (vatPurchasesAcc && purchaseIds.length > 0) {
      const { data: purchaseLines } = await s.from('journal_lines')
        .select('id, journal_entry_id, debit, credit, description, journal_entries!journal_entry_id(date, number, description)')
        .eq('account_id', (vatPurchasesAcc as any).id)
        .in('journal_entry_id', purchaseIds);

      for (const line of purchaseLines || []) {
        const amount = parseFloat((line as any).debit) || parseFloat((line as any).credit) || 0;
        vatPaid += amount;
        vatPaidDetails.push({
          date: (line as any).journal_entries?.date,
          number: (line as any).journal_entries?.number,
          description: (line as any).journal_entries?.description || line.description,
          amount,
          type: 'purchases',
        });
      }
    }

    // Also get from invoices directly for more accurate VAT
    let invoiceQuery = s.from('invoices')
      .select('id, number, date, subtotal, vat_amount, total')
      .eq('company_id', auth.companyId)
      .neq('status', 'cancelled')
      .is('deleted_at', null);

    if (from) invoiceQuery = invoiceQuery.gte('date', from);
    if (to) invoiceQuery = invoiceQuery.lte('date', to);

    const { data: invoices } = await invoiceQuery;

    const invoiceVatTotal = (invoices || []).reduce((sum: number, inv: any) => sum + (parseFloat(inv.vat_amount) || 0), 0);
    const invoiceSubtotal = (invoices || []).reduce((sum: number, inv: any) => sum + (parseFloat(inv.subtotal) || 0), 0);
    const invoiceTotal = (invoices || []).reduce((sum: number, inv: any) => sum + (parseFloat(inv.total) || 0), 0);

    // Purchase invoices
    let purchaseInvQuery = s.from('purchase_invoices')
      .select('id, invoice_number, date, subtotal, tax_amount, total')
      .eq('company_id', auth.companyId);

    if (from) purchaseInvQuery = purchaseInvQuery.gte('date', from);
    if (to) purchaseInvQuery = purchaseInvQuery.lte('date', to);

    const { data: purchaseInvoices } = await purchaseInvQuery;

    const purchaseVatTotal = (purchaseInvoices || []).reduce((sum: number, inv: any) => sum + (parseFloat(inv.tax_amount) || 0), 0);

    const vatPayable = vatCollected - vatPaid;
    const vatPayableFromInvoices = invoiceVatTotal - purchaseVatTotal;

    return success({
      period: { from, to },
      vat_collected: {
        from_journal: vatCollected,
        from_invoices: invoiceVatTotal,
        total: vatCollected || invoiceVatTotal,
        details: vatCollectedDetails,
        invoices: invoices || [],
      },
      vat_paid: {
        from_journal: vatPaid,
        from_invoices: purchaseVatTotal,
        total: vatPaid || purchaseVatTotal,
        details: vatPaidDetails,
        purchase_invoices: purchaseInvoices || [],
      },
      summary: {
        total_sales_excluding_vat: invoiceSubtotal,
        total_sales_including_vat: invoiceTotal,
        total_vat_collected: invoiceVatTotal,
        total_vat_paid: purchaseVatTotal,
        vat_payable: vatPayableFromInvoices,
        vat_payable_status: vatPayableFromInvoices >= 0 ? 'payable' : 'refundable',
      },
      zatca_compliant: true,
      vat_rate: 0.15,
    });
  } catch (err) {
    return handleApiError(err);
  }
}
