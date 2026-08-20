/**
 * Regression tests for the 2026-08-19 audit hardening fixes.
 *
 * Covers: magic-byte polyglot rejection, CSV formula-injection guard,
 * Telegram webhook secret fail-closed policy, money/quantity bounds,
 * Telegram HTML escaping, and the journal-line numeric caps.
 */
import { hasAllowedMagicBytes, trustedReceiptReference } from '@/lib/safe-input';
import { toCsvCell, recordsToCsv } from '@/lib/csv-export';
import { verifyWebhookSecret } from '@/lib/webhook-guard';
import { escapeTelegramHtml } from '@/lib/telegram';
import {
  moneyAmount,
  journalEntryLineSchema,
  invoiceSchema,
  changeOrderSchema,
  changeOrderUpdateSchema,
  voucherUpdateSchema,
  equipmentCostSchema,
  contactUpdateSchema,
} from '@/lib/validation';

/* ------------------------- helpers ------------------------- */

const realPng = () => Buffer.concat([
  Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
  Buffer.from([0x00, 0x00, 0x00, 0x0d]),
  Buffer.from('IHDR'),
  Buffer.from([0x00, 0x00, 0x00, 0x01, 0x00, 0x00, 0x00, 0x01, 0x08, 0x02, 0x00, 0x00, 0x00]),
]);

/** Minimal structurally-valid JPEG: SOI + APP0 + SOF0. */
const realJpeg = () => Buffer.concat([
  Buffer.from([0xff, 0xd8]), // SOI
  Buffer.from([0xff, 0xe0, 0x00, 0x10]), Buffer.from('JFIF\0', 'latin1'), Buffer.from([0x01, 0x01, 0x00, 0x00, 0x01, 0x00, 0x01, 0x00, 0x00]),
  Buffer.from([0xff, 0xc0, 0x00, 0x0b]), Buffer.from([0x08, 0x00, 0x01, 0x00, 0x01, 0x01, 0x01, 0x11, 0x00]),
  Buffer.from([0xff, 0xd9]), // EOI
]);

const realPdf = () => Buffer.concat([
  Buffer.from('%PDF-1.4\n1 0 obj\n<<>>\nendobj\ntrailer\n<</Size 1>>\nstartxref\n0\n'),
  Buffer.from('%%EOF'),
]);

/* --------------------- 1. magic bytes --------------------- */

describe('hasAllowedMagicBytes — polyglot/poisoned-file defense', () => {
  it('accepts a real JPEG structure', () => {
    expect(hasAllowedMagicBytes(realJpeg(), 'image/jpeg')).toBe(true);
  });
  it('accepts a real PNG (signature + IHDR)', () => {
    expect(hasAllowedMagicBytes(realPng(), 'image/png')).toBe(true);
  });
  it('accepts a real PDF (header at 0 + %%EOF trailer)', () => {
    expect(hasAllowedMagicBytes(realPdf(), 'application/pdf')).toBe(true);
  });

  it('rejects HTML+JS wearing a JPEG SOI prefix (classic polyglot)', () => {
    const evil = Buffer.concat([
      Buffer.from([0xff, 0xd8, 0xff]),
      Buffer.from('<html><script>alert(1)</script></html>'),
    ]);
    expect(hasAllowedMagicBytes(evil, 'image/jpeg')).toBe(false);
  });

  it('rejects HTML+JS embedding "%PDF-" inside the first KB', () => {
    const evil = Buffer.concat([
      Buffer.from('<!--'),
      Buffer.from('%PDF-1.7'),
      Buffer.from('--><html><script>alert(document.cookie)</script></html>'),
      Buffer.alloc(500, 0x41),
    ]);
    expect(hasAllowedMagicBytes(evil, 'application/pdf')).toBe(false);
  });

  it('rejects an HTML file whose first bytes happen to be "%PDF-"', () => {
    const evil = Buffer.from('%PDF-<html><script>alert(1)</script></html>%%EOF');
    expect(hasAllowedMagicBytes(evil, 'application/pdf')).toBe(false);
  });

  it('rejects an EXE passed as PDF (MZ header)', () => {
    expect(hasAllowedMagicBytes(Buffer.from('MZ\u0090\u0000exe'), 'application/pdf')).toBe(false);
  });

  it('rejects a PNG signature followed by HTML payload', () => {
    const evil = Buffer.concat([realPng(), Buffer.from('<script>alert(1)</script>')]);
    expect(hasAllowedMagicBytes(evil, 'image/png')).toBe(false);
  });

  it('rejects archive, executable and web signatures across the bounded window', () => {
    for (const bytes of [
      Buffer.from([0x50, 0x4b, 0x03, 0x04]), Buffer.from('Rar!'),
      Buffer.from('<iframe src=x>'), Buffer.from('<svg onload=alert(1)>'),
      Buffer.from('onerror = alert(1)'), Buffer.from('javascript:alert(1)'), Buffer.from('<?php echo 1;'),
    ]) expect(hasAllowedMagicBytes(bytes, 'application/pdf')).toBe(false);
  });

  it('covers malformed JPEG marker structures', () => {
    expect(hasAllowedMagicBytes(Buffer.from([0xff, 0xd8, 0xff]), 'image/jpeg')).toBe(false);
    expect(hasAllowedMagicBytes(Buffer.from([0xff, 0xd8, 0xff, 0xd9]), 'image/jpeg')).toBe(false);
    expect(hasAllowedMagicBytes(Buffer.from([0xff, 0xd8, 0xff, 0x01, 0, 2]), 'image/jpeg')).toBe(false);
    expect(hasAllowedMagicBytes(Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0, 1]), 'image/jpeg')).toBe(false);
    expect(hasAllowedMagicBytes(Buffer.from([0xff, 0xd8, 0xff, 0xd0, 0xff, 0xd9]), 'image/jpeg')).toBe(false);
    expect(hasAllowedMagicBytes(Buffer.from([0xff, 0xd8, 0xff, 0xff, 0xff, 0xd9]), 'image/jpeg')).toBe(false);
  });

  it('rejects short/wrong PNGs, misplaced/incomplete PDFs and unsupported MIME', () => {
    expect(hasAllowedMagicBytes(Buffer.from([0x89, 0x50]), 'image/png')).toBe(false);
    const wrongPng = Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), Buffer.from([0, 0, 0, 1]), Buffer.from('IDAT')]);
    expect(hasAllowedMagicBytes(wrongPng, 'image/png')).toBe(false);
    expect(hasAllowedMagicBytes(Buffer.from('12345%PDF-1.4\n%%EOF'), 'application/pdf')).toBe(false);
    expect(hasAllowedMagicBytes(Buffer.from('%PDF-1.4 no trailer'), 'application/pdf')).toBe(false);
    expect(hasAllowedMagicBytes(realPng(), 'image/gif')).toBe(false);
  });

  it('rejects garbage buffers for any mime', () => {
    expect(hasAllowedMagicBytes(Buffer.from('hello world'), 'image/jpeg')).toBe(false);
    expect(hasAllowedMagicBytes(Buffer.from('hello world'), 'application/pdf')).toBe(false);
    expect(hasAllowedMagicBytes(Buffer.from([]), 'image/png')).toBe(false);
  });
});

describe('trustedReceiptReference', () => {
  const company = '90000000-0000-4000-8000-000000000001';
  beforeEach(() => { process.env.NEXT_PUBLIC_SUPABASE_URL = 'https://project.supabase.co'; });
  it('accepts safe tenant paths and configured Supabase object URLs', () => {
    expect(trustedReceiptReference(`${company}/payment-proofs/a.png`, company)).toContain(company);
    const url = `https://project.supabase.co/storage/v1/object/sign/receipts/${company}/a.png`;
    expect(trustedReceiptReference(url, company)).toBe(url);
  });
  it('rejects malformed, traversal, foreign, credentialed and wrong-host references', () => {
    for (const value of [null, '', 1, 'x'.repeat(2049), `${company}/../secret`, `${company}/bad\\x`,
      'not-url', 'http://project.supabase.co/storage/v1/object/x',
      `https://evil.test/storage/v1/object/${company}/a`, `https://project.supabase.co/not-storage/${company}/a`,
      `https://project.supabase.co/storage/v1/object/other/a`]) {
      expect(trustedReceiptReference(value, company)).toBeNull();
    }
    delete process.env.NEXT_PUBLIC_SUPABASE_URL;
    delete process.env.SUPABASE_URL;
    expect(trustedReceiptReference('https://project.supabase.co/storage/v1/object/x', company)).toBeNull();
  });
});

/* --------------------- 2. CSV formula injection --------------------- */

describe('csv-export — spreadsheet formula injection guard', () => {
  it('neutralizes formula prefixes', () => {
    expect(toCsvCell('+SUM(A1)')).toBe("'+SUM(A1)");
    expect(toCsvCell('-1+2')).toBe("'-1+2");
    expect(toCsvCell('@cmd|calc')).toBe("'@cmd|calc");
    expect(toCsvCell('\t=1+1')).toBe("'\t=1+1");
    // Cells containing commas/quotes are additionally quoted after the guard.
    expect(toCsvCell('=HYPERLINK("http://evil","x")')).toBe(`"'=HYPERLINK(""http://evil"",""x"")"`);
  });
  it('quotes and escapes cells containing commas/quotes/newlines', () => {
    expect(toCsvCell('a,b')).toBe('"a,b"');
    expect(toCsvCell('say "hi"')).toBe('"say ""hi"""');
    expect(toCsvCell('line1\nline2')).toBe('"line1\nline2"');
  });
  it('leaves harmless cells untouched', () => {
    expect(toCsvCell('hello')).toBe('hello');
    expect(toCsvCell('123.45')).toBe('123.45');
    expect(toCsvCell(null)).toBe('');
  });
  it('serializes records safely', () => {
    const csv = recordsToCsv([{ name: '=cmd', note: 'ok, with comma' }]);
    expect(csv).toContain("'=cmd");
    expect(csv).toContain('"ok, with comma"');
  });
});

/* --------------------- 3. webhook secret policy --------------------- */

describe('verifyWebhookSecret — fail-closed policy', () => {
  const expected = 's'.repeat(40);
  it('accepts a matching secret in production', () => {
    expect(verifyWebhookSecret(expected, expected, true).ok).toBe(true);
  });
  it('rejects a mismatched secret in production', () => {
    expect(verifyWebhookSecret('x'.repeat(40), expected, true).ok).toBe(false);
  });
  it('rejects a missing header in production even when a secret is configured', () => {
    expect(verifyWebhookSecret(null, expected, true).ok).toBe(false);
  });
  it('rejects ALL updates in production when no secret is configured (fail closed)', () => {
    expect(verifyWebhookSecret(expected, null, true).ok).toBe(false);
    expect(verifyWebhookSecret(null, null, true).ok).toBe(false);
  });
  it('stays permissive only in development', () => {
    expect(verifyWebhookSecret(null, null, false).ok).toBe(true);
    expect(verifyWebhookSecret(null, expected, false).ok).toBe(true);
    expect(verifyWebhookSecret('bad', expected, false).ok).toBe(false);
  });
});

/* --------------------- 4. money/quantity bounds --------------------- */

describe('money bounds — reject absurd/overflowing amounts with 422 semantics', () => {
  const huge = 1e308;
  const overNum = 99999999999999.99; // > NUMERIC(15,2)
  it('moneyAmount rejects NaN/Infinity/huge/3-decimals', () => {
    for (const v of [NaN, Infinity, -Infinity, huge, 1e15, 1.001]) {
      expect(moneyAmount().safeParse(v).success).toBe(false);
    }
    expect(moneyAmount().safeParse(100.25).success).toBe(true);
  });
  it('journal line debit/credit are bounded', () => {
    expect(journalEntryLineSchema.safeParse({ accountCode: '1000', debit: 1e308, credit: 0 }).success).toBe(false);
    expect(journalEntryLineSchema.safeParse({ accountCode: '1000', debit: 100.001, credit: 0 }).success).toBe(false);
    expect(journalEntryLineSchema.safeParse({ accountCode: '1000', debit: 100.25, credit: 0 }).success).toBe(true);
  });
  it('change order amounts are bounded (negative allowed for deductive orders)', () => {
    expect(changeOrderSchema.safeParse({
      project_id: '00000000-0000-4000-8000-000000000000',
      title: 't', description: 'd',
      change_amount: -1e15, status: 'draft',
    }).success).toBe(false);
    expect(changeOrderSchema.safeParse({
      project_id: '00000000-0000-4000-8000-000000000000',
      title: 't', description: 'd',
      change_amount: -1000.5, status: 'draft',
    }).success).toBe(true);
    expect(changeOrderUpdateSchema.safeParse({ change_amount: 1e308 }).success).toBe(false);
    expect(changeOrderUpdateSchema.safeParse({ change_amount: 500.25 }).success).toBe(true);
  });
  it('voucher update amount is bounded', () => {
    expect(voucherUpdateSchema.safeParse({ amount: 1e308 }).success).toBe(false);
    expect(voucherUpdateSchema.safeParse({ amount: 1234.56 }).success).toBe(true);
  });
  it('equipment cost amount is bounded', () => {
    expect(equipmentCostSchema.safeParse({ amount: 1e308 }).success).toBe(false);
    expect(equipmentCostSchema.safeParse({ amount: 200.5 }).success).toBe(true);
  });
  it('contact credit_limit is bounded', () => {
    expect(contactUpdateSchema.safeParse({ credit_limit: 1e15 }).success).toBe(false);
    expect(contactUpdateSchema.safeParse({ credit_limit: 50000 }).success).toBe(true);
  });
  it('invoice totals are bounded', () => {
    const base = {
      clientId: '00000000-0000-4000-8000-000000000000',
      date: '2026-01-15', dueDate: '2026-02-15',
      items: [{ description: 'x', quantity: 1, unitPrice: 100 }],
      subtotal: 100, total: 115, vatAmount: 15, vatRate: 0.15,
    };
    expect(invoiceSchema.safeParse(base).success).toBe(true);
    expect(invoiceSchema.safeParse({ ...base, total: 1e308 }).success).toBe(false);
    expect(invoiceSchema.safeParse({ ...base, subtotal: NaN }).success).toBe(false);
    expect(invoiceSchema.safeParse({ ...base, vatRate: 1.5 }).success).toBe(false);
  });
});

/* --------------------- 5. telegram HTML escaping --------------------- */

describe('escapeTelegramHtml', () => {
  it('escapes markup characters', () => {
    expect(escapeTelegramHtml('<b>x</b> & "y"')).toBe('&lt;b&gt;x&lt;/b&gt; &amp; "y"');
  });
  it('handles non-strings gracefully', () => {
    expect(escapeTelegramHtml(undefined as unknown as string)).toBe('');
    expect(escapeTelegramHtml(null as unknown as string)).toBe('');
  });
});
