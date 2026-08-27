/**
 * UI component tests for the layout Sidebar navigation.
 * Run via jest -c jest.ui.config.js (jsdom + RTL).
 */
import React from 'react';
import { render, screen, fireEvent } from '@testing-library/react';
import { Sidebar } from '@/components/layout/Sidebar';

const toggleMock = jest.fn();
const setActiveMock = jest.fn();
const sidebarState = { isCollapsed: false, toggle: toggleMock, setActive: setActiveMock };
jest.mock('@/store/sidebar-store', () => ({
  useSidebarStore: () => sidebarState,
}));

const authState: { user: { role: string } | null } = { user: { role: 'admin' } };
jest.mock('@/store/auth-store', () => ({
  useAuthStore: () => authState,
}));

beforeEach(() => {
  sidebarState.isCollapsed = false;
  authState.user = { role: 'admin' };
  toggleMock.mockClear();
  setActiveMock.mockClear();
  document.body.innerHTML = '';
});

describe('Sidebar', () => {
  test('renders the brand and all top-level group labels for admin', () => {
    render(<Sidebar />);
    expect(screen.getByText('برو')).toBeInTheDocument();
    expect(screen.getByText('أكاوننت')).toBeInTheDocument();

    // Single-item groups render their label as a link
    expect(screen.getByRole('link', { name: 'الرئيسية' })).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'المقاولون' })).toHaveAttribute('href', '/subcontractors');

    // Multi-item groups render as buttons
    for (const label of ['المحاسبة', 'المشاريع', 'المشتريات', 'العملاء والموردون', 'الموارد البشرية', 'الأصول', 'التقارير', 'النظام']) {
      expect(screen.getByRole('button', { name: label })).toBeInTheDocument();
    }
  });

  test('single-item group links to /dashboard and is active on /dashboard', () => {
    render(<Sidebar />);
    const dashboardLink = screen.getByRole('link', { name: 'الرئيسية' });
    expect(dashboardLink).toHaveAttribute('href', '/dashboard');
    expect(dashboardLink.className).toContain('active');
  });

  test('clicking a multi-item group button toggles its items', () => {
    render(<Sidebar />);
    const accounting = screen.getByRole('button', { name: 'المحاسبة' });
    fireEvent.click(accounting);
    expect(screen.getByRole('link', { name: 'الحسابات' })).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'القيود' })).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'الفواتير' })).toBeInTheDocument();
    // collapse again
    fireEvent.click(accounting);
    expect(screen.queryByRole('link', { name: 'الحسابات' })).not.toBeInTheDocument();
  });

  test('admin role sees admin-only items under النظام', () => {
    render(<Sidebar />);
    fireEvent.click(screen.getByRole('button', { name: 'النظام' }));
    expect(screen.getByRole('link', { name: 'الصلاحيات' })).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'المستخدمين' })).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'الإعدادات' })).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'الباقات والاشتراك' })).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'السنوات المالية' })).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'الشكاوي والاقتراحات' })).toBeInTheDocument();
  });

  test('non-admin role hides admin-only items but keeps the rest', () => {
    authState.user = { role: 'supervisor' };
    render(<Sidebar />);
    fireEvent.click(screen.getByRole('button', { name: 'النظام' }));
    // admin-only items removed
    expect(screen.queryByRole('link', { name: 'الصلاحيات' })).not.toBeInTheDocument();
    expect(screen.queryByRole('link', { name: 'المستخدمين' })).not.toBeInTheDocument();
    expect(screen.queryByRole('link', { name: 'الإعدادات' })).not.toBeInTheDocument();
    expect(screen.queryByRole('link', { name: 'الباقات والاشتراك' })).not.toBeInTheDocument();
    expect(screen.queryByRole('link', { name: 'السنوات المالية' })).not.toBeInTheDocument();
    // non-admin items still present
    expect(screen.getByRole('link', { name: 'الشكاوي والاقتراحات' })).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'الرسائل' })).toBeInTheDocument();
  });

  test('collapsed sidebar hides labels and collapse button carries expand title', () => {
    sidebarState.isCollapsed = true;
    render(<Sidebar />);
    // brand text hidden when collapsed
    expect(screen.queryByText('أكاوننت')).not.toBeInTheDocument();
    // collapse toggle button now offers to expand
    const toggleBtn = screen.getByRole('button', { name: 'توسيع القائمة' });
    fireEvent.click(toggleBtn);
    expect(toggleMock).toHaveBeenCalledTimes(1);
  });

  test('collapsed multi-group button navigates to first item and sets active', () => {
    sidebarState.isCollapsed = true;
    render(<Sidebar />);
    const accounting = screen.getByRole('button', { name: 'المحاسبة' });
    fireEvent.click(accounting);
    // eslint-disable-next-line @typescript-eslint/no-require-imports -- intentional: reaches next/navigation internal router
    const { __router } = require('next/navigation');
    expect(__router.push).toHaveBeenCalledWith('/accounts');
    expect(setActiveMock).toHaveBeenCalledWith('accounts');
  });

  test('clicking a child link sets the active item', () => {
    render(<Sidebar />);
    fireEvent.click(screen.getByRole('button', { name: 'المشاريع' }));
    fireEvent.click(screen.getByRole('link', { name: 'المشاريع' }));
    // Note: there are two 'المشاريع' texts (button + item). Find the link inside expanded list.
    const projectsLink = screen.getByRole('link', { name: 'المشاريع' });
    expect(projectsLink).toHaveAttribute('href', '/projects');
    expect(setActiveMock).toHaveBeenCalledWith('projects');
  });
});
