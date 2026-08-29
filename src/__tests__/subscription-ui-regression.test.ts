/** Regression coverage for the subscription billing surface (Telegram receipt flow). */

import fs from 'fs';
import path from 'path';

import {
  NOTIFICATIONS_UPDATED_EVENT,
  publishUnreadNotificationCount,
  readUnreadNotificationCount,
} from '@/lib/notification-events';

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

describe('subscription page source (Telegram receipt flow)', () => {
  const page = fs.readFileSync(
    path.join(process.cwd(), 'src/app/(dashboard)/subscription/page.tsx'),
    'utf8',
  );

  test('no receipt file upload UI remains — receipts go through Telegram', () => {
    expect(page).not.toContain('/api/upload/receipt');
    expect(page).not.toContain('uploadReceipt');
    expect(page).not.toContain('receipt_image_url');
    expect(page).toContain('t.me');
    expect(page).toContain('أرسل صورة الإيصال');
  });

  test('no sequential-number fallback: subscriber number comes from the API only', () => {
    expect(page).not.toContain("id?.substring(0, 8)");
    expect(page).toContain('subscriber_number');
  });

  test('unified current-subscription card replaces duplicated cards', () => {
    expect(page).not.toContain('الإضافات المفعلة على اشتراكك');
    expect(page).toContain('اشتراكك الحالي');
    // current plan is renewable instead of disabled
    expect(page).toContain('تجديد نفس الباقة');
  });

  test('pending requests can be cancelled by the owner', () => {
    expect(page).toContain("method: 'DELETE'");
  });
});
