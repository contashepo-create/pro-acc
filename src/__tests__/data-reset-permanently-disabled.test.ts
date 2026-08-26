/**
 * Regression guard: تصفير قاعدة بيانات الشركة مُلغاة نهائياً.
 *
 * يتحقق من الطبقات الأربع معاً:
 *  1. المسار البرمجي /api/company/reset قبر كامل (410 لكل الأفعال).
 *  2. بوابة تيليجرام لم تعد تستدعي أي RPC للتصفير ولا تصدر رموزاً.
 *  3. ميجريشن 088 يحذف دوال التصفير من قاعدة البيانات نفسها.
 *  4. لا يوجد أي مرجع متبقٍ في كود التطبيق لدوال التصفير.
 */
process.env.TOKEN_SECRET = 'test-secret-key-for-unit-tests-32chars!';
import fs from 'node:fs';
import path from 'node:path';
import { createToken } from '@/lib/auth';
import type { NextRequest } from 'next/server';

const root = process.cwd();
const read = (file: string) => fs.readFileSync(path.join(root, file), 'utf8');

jest.mock('@/lib/supabase-client', () => ({
  getSupabase: () => { throw new Error('the tombstone route must never reach the database'); },
}));

/* eslint-disable @typescript-eslint/no-require-imports */
const resetRoute = require('@/app/api/company/reset/route') as {
  POST: (req: NextRequest) => Promise<Response>;
  DELETE: (req: NextRequest) => Promise<Response>;
};

function req(method: 'POST' | 'DELETE') {
  const token = createToken('u1', 'admin', 0);
  return {
    url: 'http://localhost/api/company/reset',
    method,
    nextUrl: new URL('http://localhost/api/company/reset'),
    headers: { get: (k: string) => (k === 'authorization' ? `Bearer ${token}` : null) },
    cookies: { get: () => undefined },
    json: async () => ({ action: 'confirm', code: '000000' }),
  } as unknown as NextRequest;
}

const RESET_FUNCTION_NAMES = [
  'reset_company_business_data',
  'reset_company_business_data_v56_internal',
  'start_telegram_reset_session_atomic',
  'approve_telegram_reset_session_atomic',
  'reject_telegram_reset_session_atomic',
  'cancel_telegram_reset_session_atomic',
];

describe('company database reset is permanently disabled', () => {
  test('POST and DELETE answer 410 Gone with the removal message', async () => {
    for (const method of ['POST', 'DELETE'] as const) {
      const res = await resetRoute[method](req(method));
      expect(res.status).toBe(410);
      const json = await res.json();
      expect(json.success).toBe(false);
      expect(String(json.message)).toContain('أُلغيت نهائياً');
    }
  });

  test('the telegram webhook never invokes a reset RPC nor mints a code', () => {
    const webhook = read('src/app/api/telegram/webhook/route.ts');
    for (const fn of RESET_FUNCTION_NAMES) {
      expect(webhook).not.toContain(fn);
    }
    expect(webhook).not.toMatch(/randomInt/);
    expect(webhook).toContain('أُلغيت نهائياً');
  });

  test('migration 088 drops every reset function from the database', () => {
    const migration = read('src/migrations/088-disable-company-data-reset.sql');
    for (const fn of RESET_FUNCTION_NAMES) {
      expect(migration).toMatch(new RegExp(`DROP FUNCTION IF EXISTS public\\.${fn}\\(`));
    }
    // Any historically pending session is cleared.
    expect(migration).toContain('SET reset_session_data = NULL');
  });

  test('no application source file references the removed RPCs anymore', () => {
    const walk = (dir: string): string[] => fs.readdirSync(path.join(root, dir), { withFileTypes: true })
      .flatMap((entry) => {
        const full = path.join(dir, entry.name);
        if (entry.isDirectory()) return walk(full);
        return /\.(ts|tsx)$/.test(entry.name) ? [full] : [];
      });
    const offenders = walk('src/app').filter((file) => {
      if (file.includes('__tests__')) return false;
      const src = read(file);
      // A literal comment mention is fine; an actual .rpc('...') call is not.
      return RESET_FUNCTION_NAMES.some((fn) => new RegExp(`\\.rpc\\(\\s*['"]${fn}['"]`).test(src));
    });
    expect(offenders).toEqual([]);
  });
});
