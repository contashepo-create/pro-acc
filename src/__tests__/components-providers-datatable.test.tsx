/**
 * UI component tests for Providers and DataTable search.
 * Run via jest -c jest.ui.config.js (jsdom + RTL).
 */
import React from 'react';
import { render, screen, fireEvent } from '@testing-library/react';
import Providers from '@/components/Providers';
import { DataTable } from '@/components/ui/DataTable';

const checkSessionMock = jest.fn();
jest.mock('@/store/auth-store', () => ({ useAuthStore: (sel: any) => sel({ checkSession: checkSessionMock }) }));
jest.mock('@tanstack/react-query', () => {
  const React = require('react');
  return {
    QueryClient: class { },
    QueryClientProvider: ({ children }: any) => React.createElement(React.Fragment, null, children),
  };
});

const pathnameRef: { current: string } = { current: '/dashboard' };
jest.mock('next/navigation', () => ({ usePathname: () => pathnameRef.current, useRouter: () => ({}) }));

afterEach(() => {
  jest.clearAllMocks();
  document.body.innerHTML = '';
});

describe('Providers', () => {
  test('calls checkSession on a protected route', () => {
    pathnameRef.current = '/dashboard';
    render(<Providers>محتوى</Providers>);
    expect(checkSessionMock).toHaveBeenCalled();
    expect(screen.getByText('محتوى')).toBeInTheDocument();
  });

  test('skips checkSession on a public route', () => {
    pathnameRef.current = '/login';
    render(<Providers>محتوى</Providers>);
    expect(checkSessionMock).not.toHaveBeenCalled();
  });
});

describe('DataTable search', () => {
  const columns = [
    { key: 'name', label: 'الاسم' },
    { key: 'status', label: 'الحالة' },
  ];
  const data = [
    { id: '1', name: 'عميل أ', status: 'active' },
    { id: '2', name: 'عميل ب', status: 'active' },
  ];

  test('filters rows by the search query', () => {
    render(<DataTable columns={columns} data={data} searchable searchKeys={['name']} />);
    expect(screen.getByText('عميل أ')).toBeInTheDocument();
    fireEvent.change(screen.getByPlaceholderText('بحث...'), { target: { value: 'ب' } });
    expect(screen.queryByText('عميل أ')).not.toBeInTheDocument();
    expect(screen.getByText('عميل ب')).toBeInTheDocument();
  });
});
