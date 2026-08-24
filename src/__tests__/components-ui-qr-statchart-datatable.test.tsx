/**
 * UI component tests for QRCode, StatCard trend and DataTable.
 * Run via jest -c jest.ui.config.js (jsdom + RTL).
 */
import React from 'react';
import { render, screen } from '@testing-library/react';
import { QRCode } from '@/components/ui/QRCode';
import { StatCard } from '@/components/ui/StatCard';
import { DataTable } from '@/components/ui/DataTable';

const toCanvasMock = jest.fn();
jest.mock('qrcode', () => ({ toCanvas: (...a: unknown[]) => toCanvasMock(...a) }));

afterEach(() => {
  jest.clearAllMocks();
});

describe('QRCode', () => {
  test('draws a QR canvas for the value', () => {
    render(<QRCode value="https://example.com" size={64} />);
    expect(toCanvasMock).toHaveBeenCalled();
  });
});

describe('StatCard trend', () => {
  test('renders the trend percentage and direction', () => {
    render(<StatCard title="المبيعات" value="500" trend={{ direction: 'up', percentage: 12.5 }} />);
    expect(screen.getByText('12.5%')).toBeInTheDocument();
  });
});

describe('DataTable', () => {
  const columns = [
    { key: 'name', label: 'الاسم' },
    { key: 'total', label: 'الإجمالي' },
  ];
  const data = [{ id: '1', name: 'عميل', total: 200 }];

  test('renders rows from the provided data', () => {
    render(<DataTable columns={columns} data={data} />);
    expect(screen.getByText('عميل')).toBeInTheDocument();
    expect(screen.getByText('200')).toBeInTheDocument();
  });

  test('renders the empty message for empty data', () => {
    render(<DataTable columns={columns} data={[]} emptyMessage="لا توجد بيانات" />);
    expect(screen.getByText('لا توجد بيانات')).toBeInTheDocument();
  });
});
