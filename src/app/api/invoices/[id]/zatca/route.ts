import { NextRequest } from 'next/server';
import { success, error, notFound, requireModulePermission, handleApiError } from '@/lib/api-helpers';
import { getSupabase } from '@/lib/supabase-client';
import { generateUBLInvoice, generateZatcaQRData, validateInvoiceForZatca } from '@/lib/zatca';
import { isValidDate } from '@/lib/utils';

const sb = () => getSupabase();
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const roundMoney = (value: number) => Math.round((value + Number.EPSILON) * 100) / 100;
const moneyMatches = (left: number, right: number) => Math.abs(left - right) <= 0.01;

type PartySnapshot = {
  name?: unknown;
  vat_number?: unknown;
  commercial_registration?: unknown;
  address?: unknown;
  country_code?: unknown;
  currency_code?: unknown;
};

type TaxSnapshot = { seller?: PartySnapshot; buyer?: PartySnapshot };

const text = (value: unknown) => typeof value === 'string' ? value.trim() : '';
const countryCode = (value: unknown, fallback = 'SA') => {
  const code = text(value).toUpperCase();
  return /^[A-Z]{2}$/.test(code) ? code : fallback;
};

/**
 * Generate deterministic ZATCA-oriented artifacts from immutable invoice facts.
 * The UBL payload is intentionally unsigned; no Phase 2 clearance/reporting is
 * performed by this endpoint.
 */
export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const auth = await requireModulePermission(request, 'invoices', 'read');
    const { id } = await params;
    if (!UUID_RE.test(id)) return error('معرّف الفاتورة غير صالح', 400);
    const s = sb();

    const { data: invoice, error: invoiceError } = await s.from('invoices')
      .select('id, number, date, subtotal, vat_rate, vat_amount, total, status, created_at, tax_snapshot')
      .eq('id', id)
      .eq('company_id', auth.companyId)
      .is('deleted_at', null)
      .maybeSingle();
    if (invoiceError) throw invoiceError;
    if (!invoice || (invoice as Record<string, unknown>).status === 'cancelled') return notFound();

    const { data: itemRows, error: itemsError } = await s.from('invoice_items')
      .select('id, description, quantity, unit_price, total')
      .eq('invoice_id', id)
      .eq('company_id', auth.companyId)
      .order('id');
    if (itemsError) throw itemsError;

    const inv = invoice as Record<string, unknown>;
    const snapshot = (inv.tax_snapshot || {}) as TaxSnapshot;
    const seller = snapshot.seller || {};
    const buyer = snapshot.buyer || {};
    const sellerName = text(seller.name);
    const sellerVatNumber = text(seller.vat_number);
    const buyerName = text(buyer.name);
    const buyerVatNumber = text(buyer.vat_number);
    const currency = text(seller.currency_code).toUpperCase();

    if (!sellerName || !buyerName || !/^\d{15}$/.test(sellerVatNumber)
      || (buyerVatNumber !== '' && !/^\d{15}$/.test(buyerVatNumber))
      || !/^[A-Z]{3}$/.test(currency)) {
      return error('بيانات الهوية الضريبية المحفوظة مع الفاتورة غير مكتملة أو غير صالحة', 422);
    }

    const issueDate = text(inv.date);
    const createdAt = new Date(text(inv.created_at));
    if (!isValidDate(issueDate) || !Number.isFinite(createdAt.getTime())) {
      return error('بيانات إصدار الفاتورة غير صالحة', 409);
    }
    const issueTime = createdAt.toISOString().slice(11, 19);
    const issueTimestamp = `${issueDate}T${issueTime}Z`;

    const invoiceNumber = Number(inv.number);
    const subtotal = Number(inv.subtotal);
    const vatRate = Number(inv.vat_rate);
    const vatAmount = Number(inv.vat_amount);
    const total = Number(inv.total);
    const items = (itemRows || []).map((item: Record<string, unknown>) => ({
      id: text(item.id),
      description: text(item.description),
      quantity: Number(item.quantity),
      unitPrice: Number(item.unit_price),
      vatRate,
      total: Number(item.total),
    }));
    const itemSubtotal = roundMoney(items.reduce((sum, item) => sum + item.total, 0));
    const invalidAmounts = !items.length || !Number.isInteger(invoiceNumber) || invoiceNumber <= 0
      || ![subtotal, vatRate, vatAmount, total].every(Number.isFinite)
      || subtotal < 0 || vatRate < 0 || vatRate > 1 || vatAmount < 0 || total < 0
      || items.some((item) => !item.description
        || ![item.quantity, item.unitPrice, item.total].every(Number.isFinite)
        || item.quantity <= 0 || item.unitPrice < 0 || item.total < 0)
      || !moneyMatches(itemSubtotal, subtotal)
      || !moneyMatches(roundMoney(subtotal * vatRate), vatAmount)
      || !moneyMatches(roundMoney(subtotal + vatAmount), total);
    if (invalidAmounts) {
      return error('البيانات المالية للفاتورة غير متسقة؛ تعذر إنشاء مستند ضريبي موثوق', 409);
    }
    if (vatRate === 0) {
      return error('لا تحتوي الفاتورة على تصنيف وسبب الإعفاء/النسبة الصفرية اللازمين للمستند الضريبي', 422);
    }

    const qrPayload = {
      sellerName,
      vatNumber: sellerVatNumber,
      timestamp: issueTimestamp,
      invoiceTotal: total,
      vatTotal: vatAmount,
    };
    const qrValidation = validateInvoiceForZatca(qrPayload);
    if (!qrValidation.valid) {
      return error(`تعذر إنشاء رمز الفاتورة الضريبية: ${qrValidation.errors.join('، ')}`, 422);
    }
    const qrData = generateZatcaQRData(qrPayload);

    const sellerCountry = countryCode(seller.country_code);
    const buyerCountry = countryCode(buyer.country_code, sellerCountry);
    const ublXml = generateUBLInvoice({
      uuid: String(inv.id),
      number: invoiceNumber,
      issueDate,
      issueTime,
      invoiceTypeCode: '388',
      invoiceTypeName: buyerVatNumber ? '0100000' : '0200000',
      currencyCode: currency,
      seller: {
        name: sellerName,
        vatNumber: sellerVatNumber,
        registrationNumber: text(seller.commercial_registration) || undefined,
        address: text(seller.address) ? { street: text(seller.address), country: sellerCountry } : { country: sellerCountry },
      },
      buyer: {
        name: buyerName,
        vatNumber: buyerVatNumber || undefined,
        address: text(buyer.address) ? { street: text(buyer.address), country: buyerCountry } : { country: buyerCountry },
      },
      items,
      amounts: {
        lineExtensionAmount: subtotal,
        taxExclusiveAmount: subtotal,
        taxInclusiveAmount: total,
        taxAmount: vatAmount,
      },
      vatRate,
    });

    return success({
      invoiceId: id,
      invoiceNumber,
      qrData,
      ublXml,
      artifact: {
        format: 'ubl_2_1_unsigned',
        qrProfile: 'zatca_phase_1_tlv_tags_1_to_5',
        cryptographicallySigned: false,
        hashChained: false,
        clearanceSubmitted: false,
        reportingSubmitted: false,
        phase2Compliant: false,
      },
    });
  } catch (err) {
    return handleApiError(err);
  }
}
