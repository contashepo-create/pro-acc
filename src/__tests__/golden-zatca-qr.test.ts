/**
 * Golden / canary tests for ZATCA Phase 1 QR TLV encoding.
 *
 * These tests use a **reference encoder written from scratch inside this file**
 * — NOT the production generateZatcaQRData() — so if the production code
 * drifts, the reference still catches it.
 *
 * Covered edge-cases:
 *   • Multi-byte UTF-8 seller names (Arabic) — TLV length is byte-count, not
 *     JS string length. Getting this wrong produces an invalid QR that Phase 2
 *     gateways and ZATCA apps will reject.
 *   • Floating-point total/VAT pairs that are exact in decimal but tricky in
 *     IEEE-754 (e.g. 0.1 + 0.2).
 *   • Large totals and zero-VAT invoices.
 */

import { generateZatcaQRData } from '@/lib/zatca/qr-code';

/* ── reference (independent) TLV encoder ── */
function refTlvEncode(tag: number, value: string): Buffer {
  const v = Buffer.from(value, 'utf-8');
  return Buffer.concat([Buffer.from([tag]), Buffer.from([v.length]), v]);
}

function refQR(data: {
  sellerName: string;
  vatNumber: string;
  timestamp: string;
  invoiceTotal: number;
  vatTotal: number;
}): string {
  return Buffer.concat([
    refTlvEncode(1, data.sellerName),
    refTlvEncode(2, data.vatNumber),
    refTlvEncode(3, data.timestamp),
    refTlvEncode(4, data.invoiceTotal.toFixed(2)),
    refTlvEncode(5, data.vatTotal.toFixed(2)),
  ]).toString('base64');
}

/* ── fixtures ── */
const CASES = [
  {
    name: 'standard Arabic seller, 15 % VAT',
    input: {
      sellerName: 'شركة المقاولات المتحدة',
      vatNumber: '300000000000003',
      timestamp: '2026-07-15T14:30:00Z',
      invoiceTotal: 1150.0,
      vatTotal: 150.0,
    },
  },
  {
    name: 'zero VAT (zero-rated goods)',
    input: {
      sellerName: 'Acme Corp',
      vatNumber: '310000000000001',
      timestamp: '2026-01-01T00:00:00Z',
      invoiceTotal: 500.0,
      vatTotal: 0.0,
    },
  },
  {
    name: 'IEEE-754 tricky decimals (0.1 + 0.2 ≠ 0.3)',
    input: {
      sellerName: 'مؤسسة فحص',
      vatNumber: '320000000000009',
      timestamp: '2026-06-30T23:59:59Z',
      invoiceTotal: 0.3,
      vatTotal: 0.05,
    },
  },
  {
    name: 'large total, single Arabic char seller',
    input: {
      sellerName: 'ع',
      vatNumber: '399999999999999',
      timestamp: '2026-12-31T12:00:00Z',
      invoiceTotal: 999999.99,
      vatTotal: 149999.99,
    },
  },
];

/* ── tests ── */
describe('Golden ZATCA QR TLV encoding', () => {
  for (const { name, input } of CASES) {
    test(name, () => {
      const actual = generateZatcaQRData(input);
      const expected = refQR(input);
      // Byte-for-byte equality of the base-64 output.
      expect(actual).toBe(expected);

      // Additionally, decode back and assert the TLV length field is the
      // *byte* length of the value, not the JS char length (critical for
      // multi-byte Arabic text).
      const buf = Buffer.from(actual, 'base64');
      let offset = 0;
      const sellerNameBytes = Buffer.from(input.sellerName, 'utf-8');
      expect(buf[offset]).toBe(1); // tag
      offset++;
      expect(buf[offset]).toBe(sellerNameBytes.length); // byte-length, NOT .length
      offset++;
      const extractedName = buf.subarray(offset, offset + sellerNameBytes.length).toString('utf-8');
      expect(extractedName).toBe(input.sellerName);
    });
  }
});
