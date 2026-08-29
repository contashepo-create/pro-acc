/**
 * Tests for security-oriented input validation (safe-input.ts).
 * Pure functions — no external dependencies.
 *
 * Covers: path traversal, URL validation, and payment proof trust boundaries.
 * (magic-byte file checks were removed with the contract-document storage
 * upload feature they served.)
 */

import {
  safeInternalPath,
  safeHttpsUrl,
  trustedReceiptReference,
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
    expect(safeHttpsUrl(42)).toBeNull();
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
    expect(trustedReceiptReference(42, companyId)).toBeNull();
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
