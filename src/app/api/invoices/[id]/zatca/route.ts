import { NextRequest } from 'next/server';
import { success, error, requireApiAuth, handleApiError } from '@/lib/api-helpers';
import { getSupabase } from '@/lib/supabase-client';
import { generateUBLInvoice } from '@/lib/zatca';

const sb = () => getSupabase();

/**
 * GET /api/invoices/[id]/zatca - Generate ZATCA UBL XML and QR data for an invoice
 * Returns both the QR code data (base64 TLV) and the full UBL 2.1 XML document
 */
export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const auth = await requireApiAuth(request);
    const { id } = await params;
    const s = sb();

    // Fetch the invoice
    const { data: invoice } = await s.from('invoices')
      .select('id, number, date, due_date, subtotal, tax_rate, tax_amount, total, notes, contact_id, zatca_qr')
      .eq('id', id)
      .eq('company_id', auth.companyId)
      .maybeSingle();

    if (!invoice) return error('الفاتورة غير موجودة');
    const inv = invoice as {
      id: string; number: number; date: string; due_date: string;
      subtotal: number; tax_rate: number; tax_amount: number; total: number;
      notes: string; contact_id: string; zatca_qr: string | null;
    };

    // Fetch invoice items
    const { data: items } = await s.from('invoice_items')
      .select('id, description, quantity, unit_price, total')
      .eq('invoice_id', id);

    // Fetch company info (seller)
    const { data: company } = await s.from('companies')
      .select('name, tax_number, address, phone, email, currency_symbol, country_code')
      .eq('id', auth.companyId)
      .maybeSingle();
    const seller = company as { name?: string; tax_number?: string; address?: string; currency_symbol?: string; country_code?: string } | null;

    // Fetch client info (buyer)
    const { data: contact } = await s.from('contacts')
      .select('id, name, tax_number, address, email')
      .eq('id', inv.contact_id)
      .eq('company_id', auth.companyId)
      .maybeSingle();
    const buyer = contact as { name?: string; tax_number?: string; address?: string } | null;

    // Generate QR data if not already stored
    let qrData = inv.zatca_qr;
    if (!qrData && seller?.tax_number && /^\d{15}$/.test(seller.tax_number)) {
      const { generateZatcaQRData } = await import('@/lib/zatca');
      try {
        qrData = generateZatcaQRData({
          sellerName: seller.name || '',
          vatNumber: seller.tax_number,
          timestamp: new Date(inv.date).toISOString(),
          invoiceTotal: parseFloat(String(inv.total)),
          vatTotal: parseFloat(String(inv.tax_amount)),
        });
        // Store for future use
        await s.from('invoices').update({ zatca_qr: qrData }).eq('id', id);
      } catch {
        // ignore
      }
    }

    // Generate UBL XML
    let ublXml: string | null = null;
    try {
      ublXml = generateUBLInvoice({
        uuid: inv.id,
        number: inv.number,
        issueDate: inv.date,
        issueTime: new Date().toISOString().split('T')[1]?.substring(0, 8) || '00:00:00',
        invoiceTypeCode: '388', // Tax Invoice
        currencyCode: 'SAR',
        seller: {
          name: seller?.name || '',
          vatNumber: seller?.tax_number || '',
          address: seller?.address ? { city: seller.address, country: 'SA' } : undefined,
        },
        buyer: {
          name: buyer?.name || '',
          vatNumber: buyer?.tax_number || undefined,
          address: buyer?.address ? { city: buyer.address, country: 'SA' } : undefined,
        },
        items: (items || []).map((item: { id: string; description: string; quantity: number; unit_price: number; total: number }, idx: number) => ({
          id: String(idx + 1),
          description: item.description,
          quantity: parseFloat(String(item.quantity)),
          unitPrice: parseFloat(String(item.unit_price)),
          vatRate: parseFloat(String(inv.tax_rate)),
          total: parseFloat(String(item.total)),
        })),
        amounts: {
          lineExtensionAmount: parseFloat(String(inv.subtotal)),
          taxExclusiveAmount: parseFloat(String(inv.subtotal)),
          taxInclusiveAmount: parseFloat(String(inv.total)),
          taxAmount: parseFloat(String(inv.tax_amount)),
        },
        vatRate: parseFloat(String(inv.tax_rate)),
        paymentMeansCode: '10', // Cash
        notes: inv.notes ? [inv.notes] : undefined,
      });
    } catch (ublErr) {
      console.warn('UBL XML generation failed:', ublErr);
    }

    return success({
      invoiceId: id,
      invoiceNumber: inv.number,
      qrData,          // Base64 TLV for QR code rendering
      ublXml,          // Full UBL 2.1 XML document
      hasValidVATNumber: !!(seller?.tax_number && /^\d{15}$/.test(seller.tax_number)),
    });
  } catch (err) {
    return handleApiError(err);
  }
}
