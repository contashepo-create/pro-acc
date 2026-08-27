/**
 * UI component tests for the layout Header.
 * Run via jest -c jest.ui.config.js (jsdom + RTL).
 */
import React from 'react';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import Header from '@/components/layout/Header';

const toggleModeMock = jest.fn();
const logoutMock = jest.fn();
const setMobileOpenMock = jest.fn();

const themeState = { isDark: false, toggleMode: toggleModeMock };
jest.mock('@/store/theme-store', () => ({ useThemeStore: () => themeState }));

const sidebarState = { isCollapsed: false, setMobileOpen: setMobileOpenMock };
jest.mock('@/store/sidebar-store', () => ({ useSidebarStore: () => sidebarState }));

const authState: {
  user: { name: string; role: string; email: string };
  company: { name: string; logo_url: string | null };
  logout: jest.Mock;
} = {
  user: { name: 'مدير', role: 'admin', email: 'admin@example.com' },
  company: { name: 'شركة', logo_url: null },
  logout: logoutMock,
};
jest.mock('@/store/auth-store', () => ({ useAuthStore: () => authState }));

jest.mock('@/lib/notification-events', () => ({
  NOTIFICATIONS_UPDATED_EVENT: 'notifications:updated',
  readUnreadNotificationCount: () => 0,
}));

const fetchMock = jest.fn();
global.fetch = fetchMock as unknown as typeof fetch;

// eslint-disable-next-line @typescript-eslint/no-require-imports -- intentional: reaches next/navigation internal router for layout tests
const { __router } = require('next/navigation');

beforeEach(() => {
  themeState.isDark = false;
  authState.user = { name: 'مدير', role: 'admin', email: 'admin@example.com' };
  authState.company = { name: 'شركة', logo_url: null };
  toggleModeMock.mockClear();
  logoutMock.mockClear();
  setMobileOpenMock.mockClear();
  __router.push.mockClear();
  fetchMock.mockReset();
  fetchMock.mockResolvedValue({ ok: true, json: async () => ({ success: true, data: { unreadCount: 0 } }) });
  document.body.innerHTML = '';
});

afterEach(() => {
  jest.clearAllMocks();
  document.body.innerHTML = '';
});

describe('Header', () => {
  test('renders the title', () => {
    render(<Header title="لوحة التحكم" />);
    expect(screen.getByText('لوحة التحكم')).toBeInTheDocument();
  });

  test('renders breadcrumbs with and without href', () => {
    render(
      <Header
        breadcrumbs={[
          { label: 'الرئيسية', href: '/dashboard' },
          { label: 'المحاسبة' },
        ]}
      />
    );
    expect(screen.getByRole('link', { name: 'الرئيسية' })).toHaveAttribute('href', '/dashboard');
    expect(screen.getByText('المحاسبة')).toBeInTheDocument();
  });

  test('shows company logo image when logo_url is present', () => {
    authState.company = { name: 'شركة', logo_url: 'https://example.com/logo.png' };
    render(<Header />);
    const img = screen.getByRole('img');
    expect(img).toHaveAttribute('src', 'https://example.com/logo.png');
    expect(img).toHaveAttribute('alt', 'شركة');
  });

  test('mobile menu button opens the sidebar', () => {
    render(<Header />);
    fireEvent.click(screen.getByRole('button', { name: 'القائمة' }));
    expect(setMobileOpenMock).toHaveBeenCalledWith(true);
  });

  test('toggling the search reveals an input and submitting routes to /search', async () => {
    render(<Header />);
    fireEvent.click(screen.getByTitle('بحث'));
    const input = screen.getByPlaceholderText('بحث...');
    fireEvent.change(input, { target: { value: 'فواتير' } });
    fireEvent.submit(input.closest('form')!);
    await waitFor(() => expect(__router.push).toHaveBeenCalledWith('/search?q=%D9%81%D9%88%D8%A7%D8%AA%D9%8A%D8%B1'));
  });

  test('shows notification badge with count from the API', async () => {
    fetchMock.mockResolvedValue({ ok: true, json: async () => ({ success: true, data: { unreadCount: 5 } }) });
    render(<Header />);
    expect(await screen.findByText('5', {}, { timeout: 2000 })).toBeInTheDocument();
  });

  test('caps notification badge at 9+', async () => {
    fetchMock.mockResolvedValue({ ok: true, json: async () => ({ success: true, data: { unreadCount: 42 } }) });
    render(<Header />);
    expect(await screen.findByText('9+', {}, { timeout: 2000 })).toBeInTheDocument();
  });

  test('toggles the theme', () => {
    render(<Header />);
    fireEvent.click(screen.getByTitle('الوضع الداكن'));
    expect(toggleModeMock).toHaveBeenCalledTimes(1);
  });

  test('opens the user menu and navigates to profile', async () => {
    render(<Header />);
    fireEvent.click(screen.getByRole('button', { name: /مدير/ }));
    fireEvent.click(screen.getByText('الملف الشخصي'));
    await waitFor(() => expect(__router.push).toHaveBeenCalledWith('/profile'));
  });

  test('admin sees the settings item and navigates to /settings', async () => {
    render(<Header />);
    fireEvent.click(screen.getByRole('button', { name: /مدير/ }));
    fireEvent.click(screen.getByText('الإعدادات'));
    await waitFor(() => expect(__router.push).toHaveBeenCalledWith('/settings'));
  });

  test('non-admin user does not see the settings item', () => {
    authState.user = { name: 'مدير', role: 'supervisor', email: 'admin@example.com' };
    render(<Header />);
    fireEvent.click(screen.getByRole('button', { name: /مدير/ }));
    expect(screen.queryByText('الإعدادات')).not.toBeInTheDocument();
  });

  test('logout calls logout and navigates to /login', async () => {
    logoutMock.mockResolvedValue(undefined);
    render(<Header />);
    fireEvent.click(screen.getByRole('button', { name: /مدير/ }));
    fireEvent.click(screen.getByText('تسجيل الخروج'));
    await waitFor(() => expect(logoutMock).toHaveBeenCalled());
    await waitFor(() => expect(__router.push).toHaveBeenCalledWith('/login'));
  });

  test('help item opens the help page in a new window', () => {
    const openSpy = jest.spyOn(window, 'open').mockImplementation(() => null);
    render(<Header />);
    fireEvent.click(screen.getByRole('button', { name: /مدير/ }));
    fireEvent.click(screen.getByText('المساعدة'));
    expect(openSpy).toHaveBeenCalledWith('https://help.proacc.com', '_blank');
    openSpy.mockRestore();
  });

  test('developer user sees the developer panel button', () => {
    authState.user = { name: 'مدير', role: 'admin', email: 'conta.moha@gmail.com' };
    render(<Header />);
    fireEvent.click(screen.getByRole('button', { name: /مدير/ }));
    expect(screen.getByText('لوحة المطور (Zerocold)')).toBeInTheDocument();
  });
});
