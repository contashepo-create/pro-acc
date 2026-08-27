/**
 * UI component tests for Table, Dropdown, PageContainer and Card.
 * Run via jest -c jest.ui.config.js (jsdom + RTL).
 */
import React from 'react';
import { render, screen, fireEvent } from '@testing-library/react';
import { Table } from '@/components/ui/Table';
import { Dropdown } from '@/components/ui/Dropdown';
import { PageContainer } from '@/components/layout/PageContainer';
import { Card } from '@/components/ui/Card';

afterEach(() => {
  jest.clearAllMocks();
  document.body.innerHTML = '';
});

describe('Table', () => {
  const columns = [
    { key: 'name', label: 'الاسم' },
    { key: 'amount', label: 'المبلغ', render: (row: { amount?: unknown }) => <span>{String(row.amount)}</span> },
  ];
  const data = [{ id: '1', name: 'عميل', amount: 100 }];

  test('renders column headers and row data', () => {
    render(<Table columns={columns} data={data} />);
    expect(screen.getByText('الاسم')).toBeInTheDocument();
    expect(screen.getByText('عميل')).toBeInTheDocument();
    expect(screen.getByText('100')).toBeInTheDocument();
  });

  test('renders the empty message when there is no data', () => {
    render(<Table columns={columns} data={[]} emptyMessage="لا توجد سجلات" />);
    expect(screen.getByText('لا توجد سجلات')).toBeInTheDocument();
  });
});

describe('Dropdown', () => {
  test('opens on trigger click and fires an item action', () => {
    const onClick = jest.fn();
    render(<Dropdown trigger={<button>قائمة</button>} items={[{ label: 'حذف', onClick }]} />);
    fireEvent.click(screen.getByText('قائمة'));
    expect(screen.getByText('حذف')).toBeInTheDocument();
    fireEvent.click(screen.getByText('حذف'));
    expect(onClick).toHaveBeenCalled();
  });
});

describe('PageContainer', () => {
  test('renders children with a maxWidth style', () => {
    render(<PageContainer maxWidth="1200px">محتوى</PageContainer>);
    expect(screen.getByText('محتوى')).toBeInTheDocument();
  });
});

describe('Card', () => {
  test('renders a title, children and triggers onClick', () => {
    const onClick = jest.fn();
    render(<Card title="بطاقة" onClick={onClick}>محتوى</Card>);
    expect(screen.getByText('بطاقة')).toBeInTheDocument();
    fireEvent.click(screen.getByText('محتوى'));
    expect(onClick).toHaveBeenCalled();
  });
});
