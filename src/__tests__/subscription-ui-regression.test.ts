/** Regression coverage for subscription payment-proof uploads and live badge updates. */

const COMPANY = '90000000-0000-4000-8000-000000000001';
const USER = '91000000-0000-4000-8000-000000000001';
const storageCalls: Array<{ method: string; path?: string }> = [];

const storageBucket = {
  list: jest.fn(async (path: string) => {
    storageCalls.push({ method: 'list', path });
    return { data: [], error: null };
  }),
  upload: jest.fn(async (path: string) => {
    storageCalls.push({ method: 'upload', path });
    return { data: { path }, error: null };
  }),
  createSignedUrl: jest.fn(async (path: string) => ({
    data: { signedUrl: `https://storage.example/${path}` }, error: null,
  })),
  remove: jest.fn(async () => ({ data: [], error: null })),
};

const db = {
  storage: { from: jest.fn(() => storageBucket) },
  from: jest.fn(() => ({ insert: jest.fn(async () => ({ error: null })) })),
};

jest.mock('@/lib/supabase-client', () => ({ getSupabase: () => db }));
jest.mock('@/lib/api-helpers', () => {
  const actual = jest.requireActual('@/lib/api-helpers');
  return {
    ...actual,
    requireApiAuth: jest.fn(async () => ({ companyId: COMPANY, userId: USER, role: 'admin' })),
  };
});

import { POST as uploadReceipt } from '@/app/api/upload/receipt/route';
import type { NextRequest } from 'next/server';
import {
  NOTIFICATIONS_UPDATED_EVENT,
  publishUnreadNotificationCount,
  readUnreadNotificationCount,
} from '@/lib/notification-events';

beforeEach(() => {
  storageCalls.length = 0;
  jest.clearAllMocks();
});

describe('subscription payment-proof upload', () => {
  test('uploads a valid proof without requiring a purchased storage add-on', async () => {
    const png = Buffer.concat([
      Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
      Buffer.from([0, 0, 0, 13]),
      Buffer.from('IHDR'),
      Buffer.alloc(16),
    ]);
    const file = {
      type: 'image/png', size: png.length,
      arrayBuffer: async () => png.buffer.slice(png.byteOffset, png.byteOffset + png.byteLength),
    };
    const request = { formData: async () => new Map([['file', file]]) } as unknown as NextRequest;

    const response = await uploadReceipt(request);
    const payload = await response.json();

    expect(response.status).toBe(200);
    expect(payload.success).toBe(true);
    expect(payload.data.reference).toMatch(new RegExp(`^${COMPANY}/payment-proofs/.+\\.png$`));
    expect(storageCalls).toEqual(expect.arrayContaining([
      { method: 'list', path: `${COMPANY}/payment-proofs` },
      expect.objectContaining({ method: 'upload', path: expect.stringContaining(`${COMPANY}/payment-proofs/`) }),
    ]));
    // The old broken flow queried subscriptions and rejected all zero-storage plans.
    expect(db.from).toHaveBeenCalledTimes(1);
    expect(db.from).toHaveBeenCalledWith('security_audit_log');
  });
});

describe('notification badge event', () => {
  test('is safe server-side and rejects malformed event details', () => {
    const originalWindow = (globalThis as { window?: unknown }).window;
    delete (globalThis as { window?: unknown }).window;
    expect(() => publishUnreadNotificationCount(2)).not.toThrow();
    expect(readUnreadNotificationCount(new Event('x'))).toBeNull();
    expect(readUnreadNotificationCount(new CustomEvent('x', { detail: { unreadCount: '3' } }))).toBeNull();
    (globalThis as { window?: unknown }).window = originalWindow;
  });

  test('publishes a normalized unread count immediately', () => {
    const originalWindow = (globalThis as { window?: unknown }).window;
    const listener = jest.fn();
    const fakeWindow = new EventTarget();
    fakeWindow.addEventListener(NOTIFICATIONS_UPDATED_EVENT, listener);
    (globalThis as { window?: unknown }).window = fakeWindow;

    try {
      publishUnreadNotificationCount(3.9);
      publishUnreadNotificationCount(-2);
      expect(listener).toHaveBeenCalledTimes(2);
      expect(readUnreadNotificationCount(listener.mock.calls[0][0])).toBe(3);
      expect(readUnreadNotificationCount(listener.mock.calls[1][0])).toBe(0);
    } finally {
      (globalThis as { window?: unknown }).window = originalWindow;
    }
  });
});
