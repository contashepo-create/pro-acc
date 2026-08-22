/**
 * UI component tests for the top-level client components.
 * Run via jest -c jest.ui.config.js (jsdom + React Testing Library).
 */
import React from 'react';
import { render, screen, act } from '@testing-library/react';
import { ThemeInitializer } from '@/components/ThemeInitializer';
import { VisitorTracker } from '@/components/VisitorTracker';
import { SubscriptionBanner } from '@/components/SubscriptionBanner';
import { AdBanner } from '@/components/AdBanner';
import { AnnouncementBar } from '@/components/AnnouncementBar';

const initThemeMock = jest.fn();
jest.mock('@/store/theme-store', () => ({ initTheme: (...a: any[]) => initThemeMock(...a) }));

const fetchMock = jest.fn();
global.fetch = fetchMock as any;

afterEach(() => {
  jest.clearAllMocks();
  jest.useRealTimers();
});

describe('ThemeInitializer', () => {
  test('calls initTheme on mount and renders nothing', () => {
    const { container } = render(<ThemeInitializer />);
    expect(initThemeMock).toHaveBeenCalled();
    expect(container.firstChild).toBeNull();
  });
});

describe('VisitorTracker', () => {
  test('tracks a non-ignored path by posting to /api/visitors', async () => {
    jest.useFakeTimers();
    fetchMock.mockResolvedValue({ ok: true });
    render(<VisitorTracker />);
    act(() => {
      jest.advanceTimersByTime(1200);
    });
    expect(fetchMock).toHaveBeenCalledWith('/api/visitors', expect.objectContaining({ method: 'POST' }));
  });
});

describe('SubscriptionBanner', () => {
  test('renders the renewal banner when the subscription is expired', async () => {
    fetchMock.mockResolvedValue({
      ok: true,
      json: async () => ({ success: true, data: { is_expired: true, is_expiring_soon: true, days_remaining: 0, plan_name: null, end_date: '2026-01-01', status: 'expired' } }),
    });
    render(<SubscriptionBanner />);
    expect(await screen.findByText(/اشتراكك منتهي/)).toBeInTheDocument();
  });

  test('renders nothing when the subscription is active', async () => {
    fetchMock.mockResolvedValue({
      ok: true,
      json: async () => ({ success: true, data: { is_expired: false, is_expiring_soon: false, days_remaining: 30, plan_name: 'pro', end_date: '2026-01-01', status: 'active' } }),
    });
    const { container } = render(<SubscriptionBanner />);
    await act(async () => { await Promise.resolve(); });
    expect(container.firstChild).toBeNull();
  });
});

describe('AdBanner', () => {
  test('renders fetched banner ads', async () => {
    fetchMock.mockResolvedValue({
      ok: true,
      json: async () => ({ success: true, data: [{ id: 'a1', title: 'إعلان', body: 'نص', type: 'banner', link_url: null, link_text: null, priority: 1 }] }),
    });
    render(<AdBanner />);
    expect(await screen.findByText('إعلان')).toBeInTheDocument();
  });
});

describe('AnnouncementBar', () => {
  test('renders an active announcement', async () => {
    fetchMock.mockResolvedValue({
      ok: true,
      json: async () => ({ success: true, data: [{ id: 'a1', title: 'تنويه', body: 'نص', type: 'announcement', link_url: null, link_text: null, priority: 1 }] }),
    });
    render(<AnnouncementBar />);
    expect(await screen.findByText('تنويه')).toBeInTheDocument();
  });
});
