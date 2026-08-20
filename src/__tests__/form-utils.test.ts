import { toDateInput, unwrapData, fetchRecord, applyDates, recordOrRow } from '@/lib/form-utils';
import * as fs from 'fs';
import * as path from 'path';

process.env.TOKEN_SECRET = 'test-secret-key-for-unit-tests-32chars!';

describe('toDateInput', () => {
  test('keeps YYYY-MM-DD', () => {
    expect(toDateInput('2026-08-01')).toBe('2026-08-01');
  });

  test('strips ISO timestamps so type=date inputs populate', () => {
    expect(toDateInput('2026-08-01T00:00:00.000Z')).toBe('2026-08-01');
    expect(toDateInput('2026-08-01 12:30:00')).toBe('2026-08-01');
  });

  test('empty / null stay empty', () => {
    expect(toDateInput(null)).toBe('');
    expect(toDateInput('')).toBe('');
  });
});

describe('unwrapData and form record helpers', () => {
  test('unwraps successful/raw payloads and rejects empty/failure payloads', () => {
    expect(unwrapData({ success: true, data: { id: 1 } })).toEqual({ id: 1 });
    expect(unwrapData({ id: 2 })).toEqual({ id: 2 });
    expect(unwrapData({ success: false, message: 'x' })).toBeNull();
    expect(unwrapData(null)).toBeNull();
  });

  test('normalizes only requested date fields without mutating input', () => {
    const input = { date: '2026-08-01T10:00:00Z', due: 'bad', name: 'x' };
    expect(applyDates(input, ['date', 'due', 'missing'])).toEqual({ date: '2026-08-01', due: '', name: 'x' });
    expect(input.date).toContain('T');
  });

  test('prefers fetched detail, then list row, then an empty record', () => {
    expect(recordOrRow({ id: 'detail' }, { id: 'row' })).toEqual({ id: 'detail' });
    expect(recordOrRow(null, { id: 'row' })).toEqual({ id: 'row' });
    expect(recordOrRow(null, null)).toEqual({});
  });

  test('fetchRecord returns detail, API messages and network errors without throwing', async () => {
    global.fetch = jest.fn()
      .mockResolvedValueOnce({ json: async () => ({ success: true, data: { id: 1 } }) })
      .mockResolvedValueOnce({ json: async () => ({ success: false, message: 'غير موجود' }) })
      .mockRejectedValueOnce(new Error('network')) as any;
    await expect(fetchRecord('/api/x/1')).resolves.toEqual({ data: { id: 1 }, error: null });
    expect(global.fetch).toHaveBeenNthCalledWith(1, '/api/x/1', { credentials: 'same-origin' });
    await expect(fetchRecord('/api/x/2')).resolves.toEqual({ data: null, error: 'غير موجود' });
    await expect(fetchRecord('/api/x/3')).resolves.toEqual({ data: null, error: 'خطأ في الاتصال بالخادم' });
  });
});

describe('GET /api/journal/[id] does not select a phantom reference column', () => {
  const src = fs.readFileSync(path.join(__dirname, '../app/api/journal/[id]/route.ts'), 'utf8');
  test('select list uses reference_type/reference_id, not reference', () => {
    expect(src).toMatch(/reference_type, reference_id/);
    expect(src).not.toMatch(/description, reference, created_by/);
  });

  test('PUT handler exists for edit save', () => {
    expect(src).toMatch(/export async function PUT/);
  });
});

describe('missing detail routes that made edit forms empty', () => {
  const fs = require('fs') as typeof import('fs');
  const path = require('path') as typeof import('path');
  test('fiscal/[id] and fixed-assets/[id] expose GET+PUT', () => {
    for (const rel of ['../app/api/fiscal/[id]/route.ts', '../app/api/fixed-assets/[id]/route.ts']) {
      const src = fs.readFileSync(path.join(__dirname, rel), 'utf8');
      expect(src).toMatch(/export async function GET/);
      expect(src).toMatch(/export async function PUT/);
    }
  });
});
