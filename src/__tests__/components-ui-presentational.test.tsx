/**
 * UI component tests for presentational src/components/ui components.
 * Run via jest -c jest.ui.config.js (jsdom + RTL).
 */
import React from 'react';
import { render, screen, fireEvent } from '@testing-library/react';
import { Badge } from '@/components/ui/Badge';
import { Button } from '@/components/ui/Button';
import { Spinner } from '@/components/ui/Spinner';
import { EmptyState } from '@/components/ui/EmptyState';
import { Card } from '@/components/ui/Card';
import { StatCard } from '@/components/ui/StatCard';
import { Switch } from '@/components/ui/Switch';
import { Pagination } from '@/components/ui/Pagination';
import { Tabs } from '@/components/ui/Tabs';
import { Tooltip } from '@/components/ui/Tooltip';
import { Divider } from '@/components/ui/Divider';
import { LoadingSkeleton } from '@/components/ui/LoadingSkeleton';

afterEach(() => {
  jest.clearAllMocks();
});

describe('Badge', () => {
  test('renders children with variant classes', () => {
    const { container } = render(<Badge variant="success">تم</Badge>);
    expect(screen.getByText('تم')).toBeInTheDocument();
    expect(container.querySelector('.badge-success')).not.toBeNull();
  });

  test('renders a dot indicator', () => {
    const { container } = render(<Badge variant="danger" dot>خطأ</Badge>);
    expect(container.querySelector('.bg-danger')).not.toBeNull();
  });
});

describe('Button', () => {
  test('renders label and calls onClick', () => {
    const onClick = jest.fn();
    render(<Button onClick={onClick}>حفظ</Button>);
    fireEvent.click(screen.getByText('حفظ'));
    expect(onClick).toHaveBeenCalled();
  });

  test('shows a spinner when loading and disables the button', () => {
    render(<Button loading>حفظ</Button>);
    expect(screen.getByLabelText('جاري التحميل')).toBeInTheDocument();
    expect(screen.getByRole('button')).toBeDisabled();
  });
});

describe('Spinner', () => {
  test('renders a status spinner with an accessible label', () => {
    render(<Spinner size="lg" color="white" />);
    expect(screen.getByLabelText('جاري التحميل')).toBeInTheDocument();
  });
});

describe('EmptyState', () => {
  test('renders title, description and triggers action', () => {
    const onAction = jest.fn();
    render(<EmptyState title="لا توجد بيانات" description="وصف" actionLabel="إضافة" onAction={onAction} />);
    expect(screen.getByText('لا توجد بيانات')).toBeInTheDocument();
    fireEvent.click(screen.getByText('إضافة'));
    expect(onAction).toHaveBeenCalled();
  });
});

describe('Card', () => {
  test('renders children', () => {
    render(<Card>محتوى</Card>);
    expect(screen.getByText('محتوى')).toBeInTheDocument();
  });
});

describe('StatCard', () => {
  test('renders a label and value', () => {
    render(<StatCard title="الإيرادات" value="100" />);
    expect(screen.getByText('الإيرادات')).toBeInTheDocument();
    expect(screen.getByText('100')).toBeInTheDocument();
  });
});

describe('Switch', () => {
  test('toggles checked state', () => {
    const onChange = jest.fn();
    render(<Switch checked={false} onChange={onChange} label="تفعيل" />);
    fireEvent.click(screen.getByRole('checkbox'));
    expect(onChange).toHaveBeenCalledWith(true);
  });
});

describe('Pagination', () => {
  test('renders page numbers and navigates', () => {
    const onPageChange = jest.fn();
    render(<Pagination currentPage={1} totalPages={3} onPageChange={onPageChange} />);
    fireEvent.click(screen.getByText('2'));
    expect(onPageChange).toHaveBeenCalledWith(2);
  });
});

describe('Tabs', () => {
  test('switches the active tab', () => {
    const items = [{ id: 'a', label: 'الأول' }, { id: 'b', label: 'الثاني' }];
    const onTabChange = jest.fn();
    render(<Tabs items={items} activeTab="a" onChange={onTabChange} />);
    fireEvent.click(screen.getByText('الثاني'));
    expect(onTabChange).toHaveBeenCalledWith('b');
  });
});

describe('Tooltip', () => {
  test('renders the tooltip content', () => {
    render(<Tooltip content="تلميح">نص</Tooltip>);
    expect(screen.getByText('نص')).toBeInTheDocument();
  });
});

describe('Divider', () => {
  test('renders a divider element', () => {
    const { container } = render(<Divider />);
    expect(container.querySelector('hr')).not.toBeNull();
  });
});

describe('LoadingSkeleton', () => {
  test('renders skeleton rows', () => {
    const { container } = render(<LoadingSkeleton count={2} />);
    expect(container.querySelectorAll('.skeleton').length).toBeGreaterThan(0);
  });
});
