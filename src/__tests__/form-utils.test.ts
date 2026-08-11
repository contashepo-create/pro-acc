import { toDateInput, unwrapData, applyDates, recordOrRow } from '@/lib/form-utils';
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

describe('unwrapData', () => {
  test('reads { success, data }', () => {
    expect(unwrapData({ success: true, data: { id: 1 } })).toEqual({ id: 1 });
    expect(unwrapData({ success: false, message: 'x' })).toBeNull();
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
