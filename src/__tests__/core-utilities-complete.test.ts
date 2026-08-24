/** Exhaustive unit tests for deterministic core utility functions. */

const maybeSingle = jest.fn();
jest.mock('@/lib/supabase-client', () => ({
  getSupabase: () => ({
    from: () => ({ select: () => ({ eq: () => ({ maybeSingle }) }) }),
  }),
}));

import {
  formatCurrency, formatDate, formatDateTime, sanitizeText, escapeHtml,
  generateId, generateCode, debounce, cn, groupBy, sumBy, isValidDate,
  truncate, parseNumber, paginate,
} from '@/lib/utils';
import {
  parseOFX, parseMT940, parseCSV, parseBankStatement, autoReconcile,
} from '@/lib/banking';
import {
  getCompanyBranding, brandingToCSS, generateInvoiceHeader, INVOICE_TEMPLATES,
  type CompanyBranding,
} from '@/lib/branding';
import { t, getDirection, formatCurrency as i18nCurrency, formatDate as i18nDate, formatNumber, type Locale } from '@/lib/i18n';
import { DEFAULT_THEME_ID, getTheme, themes } from '@/lib/themes';
import { dayIndex, priorityMeta, statusMeta } from '@/lib/gantt-types';

const branding: CompanyBranding = {
  companyId: 'c1', companyName: 'شركة آمنة', logoUrl: 'https://example.com/logo.png',
  primaryColor: '#112233', secondaryColor: '#445566', accentColor: '#778899',
  invoiceTemplate: 'modern', footerText: 'شكراً لتعاملكم', currencySymbol: 'ر.س', dateFormat: 'ar-SA',
};

describe('general utility functions', () => {
  test('formats finite currency and handles negatives, symbols and non-finite values', () => {
    expect(formatCurrency(1234.5, 'en-US', 'SAR')).toBe('1,234.50 SAR');
    expect(formatCurrency(-2, 'en-US')).toBe('-2.00');
    expect(formatCurrency(Number.NaN)).toBe('0.00');
  });

  test('formats valid dates/date-times and rejects empty or invalid values', () => {
    expect(formatDate(new Date(2026, 7, 20))).toBe('2026-08-20');
    expect(formatDate('bad')).toBe('');
    expect(formatDate(null)).toBe('');
    expect(formatDateTime(new Date(2026, 7, 20, 9, 8, 7))).toBe('2026-08-20 09:08:07');
    expect(formatDateTime(undefined)).toBe('');
    expect(formatDateTime('bad')).toBe('');
  });

  test('sanitizes display text and escapes every HTML metacharacter', () => {
    expect(sanitizeText('  <b>A</b>;&amp;\u202E  ')).toBe('A');
    expect(sanitizeText(null)).toBe('');
    expect(escapeHtml(`<&>"'`)).toBe('&lt;&amp;&gt;&quot;&#x27;');
    expect(escapeHtml(undefined)).toBe('');
  });

  test('generates UUIDs and unambiguous random codes at requested length', () => {
    expect(generateId()).toMatch(/^[0-9a-f-]{36}$/i);
    expect(generateCode()).toMatch(/^[ABCDEFGHJKLMNPQRSTUVWXYZ23456789]{8}$/);
    expect(generateCode(16)).toHaveLength(16);
  });

  test('debounces calls and forwards the final arguments', () => {
    jest.useFakeTimers();
    const target = jest.fn();
    const wrapped = debounce(target, 100);
    wrapped('first'); wrapped('last');
    expect(target).not.toHaveBeenCalled();
    jest.advanceTimersByTime(100);
    expect(target).toHaveBeenCalledTimes(1);
    expect(target).toHaveBeenCalledWith('last');
    jest.useRealTimers();
  });

  test('combines classes, groups records and sums selected values', () => {
    expect(cn('a', false, undefined, null, 'b')).toBe('a b');
    expect(groupBy([{ type: 'a', n: 1 }, { type: 'b', n: 2 }, { type: 'a', n: 3 }], 'type'))
      .toEqual({ a: [{ type: 'a', n: 1 }, { type: 'a', n: 3 }], b: [{ type: 'b', n: 2 }] });
    expect(sumBy([{ n: 2 }, { n: 0 }, { n: 3 }], (row) => row.n)).toBe(5);
  });

  test('validates real calendar dates and configured year bounds', () => {
    expect(isValidDate('2024-02-29')).toBe(true);
    for (const invalid of ['', '2023-02-29', '2026-13-01', '1899-12-31', '2101-01-01', '20-01-01']) {
      expect(isValidDate(invalid)).toBe(false);
    }
  });

  test('truncates, parses localized values and paginates safely', () => {
    expect(truncate('short', 10)).toBe('short');
    expect(truncate('a long phrase', 6)).toBe('a long...');
    expect(parseNumber('SAR -1,234.50')).toBe(-1234.5);
    expect(parseNumber(42)).toBe(42);
    expect(parseNumber(Number.NaN)).toBe(0);
    expect(parseNumber(null)).toBe(0);
    expect(parseNumber('none')).toBe(0);
    expect(paginate([1, 2, 3, 4, 5], 99, 2)).toEqual({ items: [5], total: 5, page: 3, pageSize: 2, totalPages: 3 });
    expect(paginate([], -1, 10)).toEqual({ items: [], total: 0, page: 1, pageSize: 10, totalPages: 1 });
  });
});

describe('bank statement parsers and matching', () => {
  const ofx = `<OFX><STMTTRN><DTPOSTED>20260820120000<TRNAMT>-125.50<NAME>STORE<MEMO>Invoice 7<FITID>abc-1</STMTTRN></OFX>`;
  const mt940 = `:20:START\n:61:260820D125,50\n:86:STORE Invoice 7\n:61:260821C50,00\n:86:REFUND`;
  const csv = `date,amount,description,reference\n2026-08-20,-125.50,STORE Invoice 7,abc-1\n2026-08-21,50,REFUND,abc-2`;

  test('parses OFX signs, date, text and bank reference', () => {
    expect(parseOFX(ofx)).toEqual([{ date: '2026-08-20', amount: 125.5, description: 'STORE - Invoice 7', reference: 'abc-1', type: 'debit', bankRef: 'abc-1' }]);
    expect(parseOFX('<OFX></OFX>')).toEqual([]);
  });

  test('parses MT940 debit/credit lines and details', () => {
    expect(parseMT940(mt940)).toEqual([
      { date: '2026-08-20', amount: 125.5, type: 'debit', description: 'STORE Invoice 7' },
      { date: '2026-08-21', amount: 50, type: 'credit', description: 'REFUND' },
    ]);
    expect(parseMT940(':61:malformed')).toEqual([]);
  });

  test('parses CSV defaults and custom mappings while skipping malformed rows', () => {
    expect(parseCSV(csv)).toHaveLength(2);
    expect(parseCSV('2026-08-20;SAR 10;Deposit;R1', { separator: ';', hasHeader: false })[0])
      .toMatchObject({ amount: 10, type: 'credit', reference: 'R1' });
    expect(parseCSV('h1,h2,h3\na,b')).toEqual([]);
  });

  test('covers malformed/optional parser fields and every explicit format branch', () => {
    const sparseOfx = '<STMTTRN><DTPOSTED>bad<TRNAMT>oops<MEMO>memo only</STMTTRN>';
    expect(parseOFX(sparseOfx)[0]).toMatchObject({ date: 'bad', amount: 0, description: 'memo only', reference: undefined, type: 'credit' });
    expect(parseOFX('<STMTTRN></STMTTRN>')[0]).toMatchObject({ date: '', amount: 0, description: '', reference: undefined });
    expect(parseCSV('a,b\nshort,row')).toEqual([]);
    expect(parseCSV('d,a,x\n2026-01-01,abc,desc')[0]).toMatchObject({ amount: 0, type: 'credit' });
    expect(parseCSV('date|desc|amount|ref\n2026-01-01|Pay|12|R', { separator: '|', dateCol: 0, descriptionCol: 1, amountCol: 2, referenceCol: 3 })[0]).toMatchObject({ date: '2026-01-01', description: 'Pay', amount: 12, reference: 'R' });
    expect(parseCSV('x,y,z\na,-,desc', { hasHeader: true })).toEqual([]);
    expect(parseCSV('x,y,z\na,1,desc', { dateCol: 9, descriptionCol: 9, referenceCol: 9 })[0]).toMatchObject({ date: '', description: '', reference: undefined });
    expect(parseCSV('x,y,z\na,1,desc', { amountCol: 9 })[0]).toMatchObject({ amount: 0, type: 'credit' });
    expect(parseMT940(':20:X\n:61:260820RC10,00\n:61:260821RD5,00')).toHaveLength(2);
    expect(parseBankStatement(ofx)[0].bankRef).toBe('abc-1');
    expect(parseBankStatement('<STMTTRN></STMTTRN>')).toHaveLength(1);
    expect(parseBankStatement(':20:X\n:61:260820C1,00')).toHaveLength(1);
    expect(parseBankStatement(':61:260820C1,00')).toHaveLength(1);
    expect(parseBankStatement(mt940, 'mt940')).toHaveLength(2);
    expect(parseBankStatement(csv)).toHaveLength(2);
    expect(parseBankStatement(csv, 'csv')).toHaveLength(2);
    expect(parseBankStatement(csv, 'invalid' as 'csv')).toEqual([]);
  });

  test('reconciles by correct debit/credit side, amount, date and words', () => {
    const result = autoReconcile(parseCSV(csv), [
      { id: 'j1', date: '2026-08-20', debit: 0, credit: 125.5, description: 'STORE Invoice 7' },
      { id: 'j2', date: '2026-08-21', debit: 50, credit: 0, description: 'REFUND' },
      { id: 'wrong', date: '2025-01-01', debit: 999, credit: 999, description: 'Other' },
    ]);
    expect(result.map((row) => row.matchedEntry?.id)).toEqual(['j1', 'j2']);
    expect(result[0].confidence).toBeGreaterThanOrEqual(80);
    expect(autoReconcile([{ date: 'bad', amount: 1, description: '', type: 'debit' }], []) [0])
      .toMatchObject({ matchedEntry: null, confidence: 0 });
  });
});

describe('branding, localization, themes and gantt helpers', () => {
  beforeEach(() => maybeSingle.mockReset());

  test('loads branding with configured values and defaults missing values', async () => {
    maybeSingle.mockResolvedValueOnce({ data: { id: 'c1', name: 'Acme', logo_url: null, primary_color: '#000', invoice_template: 'classic' } });
    const loaded = await getCompanyBranding('c1');
    expect(loaded).toMatchObject({ companyId: 'c1', companyName: 'Acme', primaryColor: '#000', invoiceTemplate: 'classic', currencySymbol: 'ر.س' });
    maybeSingle.mockResolvedValueOnce({ data: { id: 'empty', name: null, primary_color: null, invoice_template: null } });
    await expect(getCompanyBranding('empty')).resolves.toMatchObject({ companyName: 'Unknown', primaryColor: '#2563eb', invoiceTemplate: 'modern' });
    maybeSingle.mockResolvedValueOnce({ data: null });
    await expect(getCompanyBranding('missing')).resolves.toMatchObject({ companyName: 'Unknown', companyId: 'missing' });
    maybeSingle.mockRejectedValueOnce(new Error('down'));
    await expect(getCompanyBranding('down')).resolves.toMatchObject({ companyName: 'Unknown' });
  });

  test('maps branding to CSS and renders all invoice header styles', () => {
    expect(brandingToCSS(branding)).toEqual({ '--brand-primary': '#112233', '--brand-secondary': '#445566', '--brand-accent': '#778899' });
    expect(generateInvoiceHeader(branding)).toContain('linear-gradient');
    expect(generateInvoiceHeader({ ...branding, invoiceTemplate: 'classic' })).toContain('background: #112233');
    expect(generateInvoiceHeader({ ...branding, invoiceTemplate: 'minimal', logoUrl: null, footerText: '' })).toContain('color: #1f2937');
    const malicious = generateInvoiceHeader({ ...branding, primaryColor: 'red;position:fixed', secondaryColor: 'bad', companyName: '<script>alert(1)</script>', footerText: '<img onerror=1>' });
    expect(malicious).not.toContain('<script>');
    expect(malicious).not.toContain('<img onerror');
    expect(Object.keys(INVOICE_TEMPLATES)).toEqual(['modern', 'classic', 'minimal']);
  });

  test('translates, falls back, selects direction and formats localized values', () => {
    expect(t('common.save', 'ar')).toBe('حفظ');
    expect(t('common.save', 'en')).toBe('Save');
    expect(t('missing.key')).toBe('missing.key');
    expect(getDirection('ar')).toBe('rtl');
    expect(getDirection('en')).toBe('ltr');
    expect(i18nCurrency(12.5, 'en', 'USD')).toContain('$12.50');
    expect(i18nDate(new Date(2026, 7, 20), 'en')).toContain('2026');
    expect(formatNumber(1234, 'en')).toBe('1,234');
    expect(t('common.save', 'xx' as Locale)).toBe('حفظ');
    expect(i18nCurrency(12.5)).toContain('١٢٫٥٠');
    expect(i18nDate('2026-08-20')).toBeTruthy();
    expect(formatNumber(1234)).toContain('١');
  });

  test('returns requested/fallback themes with complete variants', () => {
    expect(DEFAULT_THEME_ID).toBe('sapphire');
    expect(getTheme('teal').id).toBe('teal');
    expect(getTheme('unknown').id).toBe(themes[0].id);
    for (const theme of themes) {
      expect(theme.dark['--color-accent']).toMatch(/^#/);
      expect(theme.light['--color-bg-primary']).toMatch(/^#/);
    }
  });

  test('computes UTC gantt day offsets and exposes status metadata', () => {
    expect(dayIndex('2026-08-23', '2026-08-20')).toBe(3);
    expect(dayIndex('2026-08-19', '2026-08-20')).toBe(-1);
    expect(statusMeta.completed.label).toBe('مكتملة');
    expect(priorityMeta.critical.variant).toBe('danger');
  });
});
