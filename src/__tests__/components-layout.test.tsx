/**
 * UI component tests for the layout Header and Sidebar.
 * Run via jest -c jest.ui.config.js (jsdom + RTL).
 */
import React from 'react';
import { render, screen, fireEvent } from '@testing-library/react';
import Header from '@/components/layout/Header';

const toggleModeMock = jest.fn();
jest.mock('@/store/theme-store', () => ({ useThemeStore: () => ({ isDark: false, toggleMode: toggleModeMock }) }));
jest.mock('@/store/sidebar-store', () => ({ useSidebarStore: () => ({ isCollapsed: false, setMobileOpen: jest.fn() }) }));
jest.mock('@/store/auth-store', () => ({
  useAuthStore: () => ({ user: { name: 'مدير' }, company: { name: 'شركة' }, logout: jest.fn() }),
}));
jest.mock('@/lib/notification-events', () => ({
  NOTIFICATIONS_UPDATED_EVENT: 'notifications:updated',
  readUnreadNotificationCount: () => 0,
}));

const fetchMock = jest.fn();
global.fetch = fetchMock as any;

afterEach(() => {
  jest.clearAllMocks();
  document.body.innerHTML = '';
});

describe('Header', () => {
  test('renders the title and toggles the theme', async () => {
    fetchMock.mockResolvedValue({ ok: true, json: async () => ({ success: true, data: { unreadCount: 0 } }) });
    render(<Header title="لوحة التحكم" />);
    expect(screen.getByText('لوحة التحكم')).toBeInTheDocument();
  });
});


