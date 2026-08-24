/**
 * UI component tests for the top-level client components.
 * Run via jest -c jest.ui.config.js (jsdom + React Testing Library).
 */
import React from 'react';
import { render, screen, act, fireEvent } from '@testing-library/react';
import { ThemeInitializer } from '@/components/ThemeInitializer';
import { VisitorTracker } from '@/components/VisitorTracker';
import { SubscriptionBanner } from '@/components/SubscriptionBanner';
import { AdBanner } from '@/components/AdBanner';
import { AnnouncementBar } from '@/components/AnnouncementBar';

const initThemeMock = jest.fn();
jest.mock('@/store/theme-store', () => ({ initTheme: (...a: unknown[]) => initThemeMock(...a) }));

const fetchMock = jest.fn();
global.fetch = fetchMock as unknown as typeof fetch;

beforeEach(() => {
  localStorage.clear();
  sessionStorage.clear();
  document.body.innerHTML = '';
});

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

  test('renders a link when the banner has one', async () => {
    fetchMock.mockResolvedValue({
      ok: true,
      json: async () => ({ success: true, data: [{ id: 'a1', title: 'إعلان', body: 'نص', type: 'banner', link_url: 'https://x.com', link_text: 'افتح' }] }),
    });
    render(<AdBanner />);
    const link = await screen.findByRole('link', { name: 'افتح' });
    expect(link).toHaveAttribute('href', 'https://x.com');
  });

  test('dismisses a banner and persists the dismissal', async () => {
    fetchMock.mockResolvedValue({
      ok: true,
      json: async () => ({ success: true, data: [{ id: 'a1', title: 'إعلان', body: 'نص', type: 'banner', link_url: null, link_text: null, priority: 1 }] }),
    });
    render(<AdBanner />);
    await screen.findByText('إعلان');
    fireEvent.click(screen.getByTitle('إخفاء'));
    expect(screen.queryByText('إعلان')).not.toBeInTheDocument();
    expect(JSON.parse(localStorage.getItem('proacc_dismissed_banners') || '[]')).toContain('a1');
  });

  test('skips banners already dismissed', async () => {
    localStorage.setItem('proacc_dismissed_banners', JSON.stringify(['a1']));
    fetchMock.mockResolvedValue({
      ok: true,
      json: async () => ({ success: true, data: [{ id: 'a1', title: 'إعلان', body: 'نص', type: 'banner', link_url: null, link_text: null, priority: 1 }] }),
    });
    const { container } = render(<AdBanner />);
    await act(async () => { await Promise.resolve(); });
    expect(container.firstChild).toBeNull();
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

  test('renders a link when the announcement has one', async () => {
    fetchMock.mockResolvedValue({
      ok: true,
      json: async () => ({ success: true, data: [{ id: 'a1', title: 'تنويه', body: 'نص', type: 'announcement', link_url: 'https://x.com', link_text: 'تفاصيل' }] }),
    });
    render(<AnnouncementBar />);
    const link = await screen.findByRole('link', { name: 'تفاصيل' });
    expect(link).toHaveAttribute('href', 'https://x.com');
  });

  test('dismisses an announcement and persists it', async () => {
    fetchMock.mockResolvedValue({
      ok: true,
      json: async () => ({ success: true, data: [{ id: 'a1', title: 'تنويه', body: 'نص', type: 'announcement', link_url: null, link_text: null, priority: 1 }] }),
    });
    render(<AnnouncementBar />);
    await screen.findByText('تنويه');
    fireEvent.click(screen.getByTitle('إخفاء الإعلان'));
    expect(screen.queryByText('تنويه')).not.toBeInTheDocument();
    const stored = JSON.parse(localStorage.getItem('proacc_dismissed_ads') || '{}');
    expect(stored).toHaveProperty('a1');
  });

  test('hides announcements whose show_until date has passed', async () => {
    fetchMock.mockResolvedValue({
      ok: true,
      json: async () => ({ success: true, data: [{ id: 'a1', title: 'منتهي', body: 'نص', type: 'announcement', show_until: '2020-01-01T00:00:00', link_url: null, link_text: null, priority: 1 }] }),
    });
    const { container } = render(<AnnouncementBar />);
    await act(async () => { await Promise.resolve(); });
    expect(container.firstChild).toBeNull();
  });

  test('renders an alert-type announcement with different styling', async () => {
    fetchMock.mockResolvedValue({
      ok: true,
      json: async () => ({ success: true, data: [{ id: 'a1', title: 'تحذير', body: 'نص', type: 'alert', link_url: null, link_text: null, priority: 1 }] }),
    });
    render(<AnnouncementBar />);
    expect(await screen.findByText('تحذير')).toBeInTheDocument();
  });
});
