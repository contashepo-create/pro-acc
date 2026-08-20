/**
 * Tests for security-oriented input validation (safe-input.ts).
 * Pure functions — no external dependencies.
 *
 * Covers: path traversal, URL validation, payment proof trust boundaries,
 * file magic-byte verification, and polyglot/injection defense.
 */

import {
  safeInternalPath,
  safeHttpsUrl,
  trustedReceiptReference,
  hasAllowedMagicBytes,
} from '@/lib/safe-input';

describe('safeInternalPath', () => {
  test('accepts valid internal paths', () => {
    expect(safeInternalPath('/dashboard')).toBe('/dashboard');
    expect(safeInternalPath('/invoices/123')).toBe('/invoices/123');
    expect(safeInternalPath('/api/data?q=test')).toBe('/api/data?q=test');
  });

  test('trims whitespace', () => {
    expect(safeInternalPath('  /dashboard  ')).toBe('/dashboard');
  });

  test('rejects null/undefined/empty', () => {
    expect(safeInternalPath(null)).toBeNull();
    expect(safeInternalPath(undefined)).toBeNull();
    expect(safeInternalPath('')).toBeNull();
  });

  test('rejects non-string values', () => {
    expect(safeInternalPath(42)).toBeNull();
    expect(safeInternalPath({})).toBeNull();
    expect(safeInternalPath(true)).toBeNull();
  });

  test('rejects protocol-relative URLs (//evil.com)', () => {
    expect(safeInternalPath('//evil.com/steal')).toBeNull();
  });

  test('rejects paths not starting with /', () => {
    expect(safeInternalPath('dashboard')).toBeNull();
    expect(safeInternalPath('http://evil.com')).toBeNull();
    expect(safeInternalPath('javascript:alert(1)')).toBeNull();
  });

  test('rejects paths with null bytes and control chars', () => {
    expect(safeInternalPath('/test\x00evil')).toBeNull();
    expect(safeInternalPath('/test\x1ftrail')).toBeNull();
  });

  test('rejects paths with backslashes', () => {
    expect(safeInternalPath('/test\\evil')).toBeNull();
  });

  test('rejects oversized paths', () => {
    expect(safeInternalPath('/' + 'x'.repeat(512))).toBeNull();
  });
});

describe('safeHttpsUrl', () => {
  test('accepts valid HTTPS URLs', () => {
    expect(safeHttpsUrl('https://example.com')).toBe('https://example.com/');
    expect(safeHttpsUrl('https://sub.example.com/path?q=1')).toBe('https://sub.example.com/path?q=1');
  });

  test('rejects HTTP (non-HTTPS)', () => {
    expect(safeHttpsUrl('http://example.com')).toBeNull();
  });

  test('rejects URLs with embedded credentials', () => {
    expect(safeHttpsUrl('https://user:pass@example.com')).toBeNull();
    expect(safeHttpsUrl('https://user@example.com')).toBeNull();
  });

  test('rejects non-URL strings', () => {
    expect(safeHttpsUrl('not a url')).toBeNull();
    expect(safeHttpsUrl('javascript:alert(1)')).toBeNull();
    expect(safeHttpsUrl('ftp://files.example.com')).toBeNull();
  });

  test('rejects empty/non-string values', () => {
    expect(safeHttpsUrl('')).toBeNull();
    expect(safeHttpsUrl(42 as any)).toBeNull();
  });

  test('respects maxLength', () => {
    expect(safeHttpsUrl('https://example.com/' + 'x'.repeat(2048))).toBeNull();
    expect(safeHttpsUrl('https://example.com', 10)).toBeNull();
  });
});

describe('trustedReceiptReference', () => {
  const companyId = 'abc123';

  test('accepts company-scoped storage paths', () => {
    expect(trustedReceiptReference('abc123/receipts/file.jpg', companyId)).toBe('abc123/receipts/file.jpg');
  });

  test('rejects path traversal in storage paths', () => {
    expect(trustedReceiptReference('abc123/../other/file.jpg', companyId)).toBeNull();
  });

  test('rejects paths not scoped to company', () => {
    expect(trustedReceiptReference('other-company/file.jpg', companyId)).toBeNull();
  });

  test('rejects empty/non-string', () => {
    expect(trustedReceiptReference('', companyId)).toBeNull();
    expect(trustedReceiptReference(null, companyId)).toBeNull();
    expect(trustedReceiptReference(42 as any, companyId)).toBeNull();
  });

  test('rejects paths with control characters', () => {
    expect(trustedReceiptReference('abc123/\x00evil.jpg', companyId)).toBeNull();
  });

  test('accepts Supabase storage URLs on the configured host', () => {
    const original = process.env.NEXT_PUBLIC_SUPABASE_URL;
    process.env.NEXT_PUBLIC_SUPABASE_URL = 'https://myproject.supabase.co';
    try {
      const url = 'https://myproject.supabase.co/storage/v1/object/public/abc123/receipt.jpg';
      expect(trustedReceiptReference(url, companyId)).toBe(url);
    } finally {
      if (original !== undefined) process.env.NEXT_PUBLIC_SUPABASE_URL = original;
      else delete process.env.NEXT_PUBLIC_SUPABASE_URL;
    }
  });

  test('rejects Supabase storage URLs on a different host', () => {
    const original = process.env.NEXT_PUBLIC_SUPABASE_URL;
    process.env.NEXT_PUBLIC_SUPABASE_URL = 'https://myproject.supabase.co';
    try {
      expect(trustedReceiptReference('https://evil.com/storage/v1/object/public/abc123/receipt.jpg', companyId)).toBeNull();
    } finally {
      if (original !== undefined) process.env.NEXT_PUBLIC_SUPABASE_URL = original;
      else delete process.env.NEXT_PUBLIC_SUPABASE_URL;
    }
  });
});

describe('hasAllowedMagicBytes', () => {
  // Valid PNG: 8-byte signature + IHDR at offset 12
  const validPng = Buffer.alloc(20);
  Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]).copy(validPng, 0);
  // IHDR chunk: 4-byte length (13) + "IHDR"
  validPng.writeUInt32BE(13, 8);
  Buffer.from('IHDR').copy(validPng, 12);

  test('accepts valid PNG', () => {
    expect(hasAllowedMagicBytes(validPng, 'image/png')).toBe(true);
  });

  test('rejects PNG with wrong magic bytes', () => {
    const bad = Buffer.from('not a png at all');
    expect(hasAllowedMagicBytes(bad, 'image/png')).toBe(false);
  });

  test('rejects PNG without IHDR', () => {
    const noIhdr = Buffer.alloc(20);
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]).copy(noIhdr, 0);
    Buffer.from('XXXX').copy(noIhdr, 12);
    expect(hasAllowedMagicBytes(noIhdr, 'image/png')).toBe(false);
  });

  test('rejects EXE files disguised as images', () => {
    const exe = Buffer.alloc(100);
    exe[0] = 0x4d; // M
    exe[1] = 0x5a; // Z
    expect(hasAllowedMagicBytes(exe, 'image/png')).toBe(false);
    expect(hasAllowedMagicBytes(exe, 'image/jpeg')).toBe(false);
  });

  test('rejects HTML polyglots in image MIME', () => {
    const html = Buffer.from('<html><script>alert(1)</script>');
    expect(hasAllowedMagicBytes(html, 'image/png')).toBe(false);
    expect(hasAllowedMagicBytes(html, 'image/jpeg')).toBe(false);
  });

  test('rejects PHP in image MIME', () => {
    const php = Buffer.from('<?php system("id"); ?>');
    expect(hasAllowedMagicBytes(php, 'image/png')).toBe(false);
  });

  // Valid PDF: %PDF-1.4 header + %%EOF trailer
  test('accepts valid PDF', () => {
    const pdfContent = '%PDF-1.4\n1 0 obj\n<< >>\nendobj\nxref\n0 1\ntrailer\n<<>>\nstartxref\n9\n%%EOF\n';
    const pdf = Buffer.from(pdfContent);
    expect(hasAllowedMagicBytes(pdf, 'application/pdf')).toBe(true);
  });

  test('rejects PDF without %%EOF trailer', () => {
    const pdf = Buffer.from('%PDF-1.4\n1 0 obj\n<< >>\nendobj\n');
    expect(hasAllowedMagicBytes(pdf, 'application/pdf')).toBe(false);
  });

  test('rejects empty buffer', () => {
    expect(hasAllowedMagicBytes(Buffer.alloc(0), 'image/png')).toBe(false);
  });

  // iframe injection
  test('rejects SVG/iframe injection payloads', () => {
    const svg = Buffer.from('<svg onload="alert(1)">');
    expect(hasAllowedMagicBytes(svg, 'image/png')).toBe(false);
    const iframe = Buffer.from('<iframe src="http://evil.com">');
    expect(hasAllowedMagicBytes(iframe, 'image/jpeg')).toBe(false);
  });
});
