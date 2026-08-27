export const NOTIFICATIONS_UPDATED_EVENT = 'proacc:notifications-updated';

/** Keep every mounted notification badge in sync without a full page reload. */
export function publishUnreadNotificationCount(unreadCount: number): void {
  if (typeof window === 'undefined') return;
  window.dispatchEvent(new CustomEvent(NOTIFICATIONS_UPDATED_EVENT, {
    detail: { unreadCount: Math.max(0, Math.trunc(unreadCount)) },
  }));
}

export function readUnreadNotificationCount(event: Event): number | null {
  const value = (event as CustomEvent<{ unreadCount?: unknown }>).detail?.unreadCount;
  return typeof value === 'number' && Number.isFinite(value)
    ? Math.max(0, Math.trunc(value))
    : null;
}
