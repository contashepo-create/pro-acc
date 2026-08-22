/**
 * UI component tests for ActionButtons and Pagination.
 * Run via jest -c jest.ui.config.js (jsdom + RTL).
 */
import React from 'react';
import { render, screen, fireEvent } from '@testing-library/react';
import { ActionButtons } from '@/components/ui/ActionButtons';
import { Pagination } from '@/components/ui/Pagination';

jest.mock('@/lib/print', () => ({ openPrintWindow: () => ({ ok: true }) }));

afterEach(() => {
  jest.clearAllMocks();
  document.body.innerHTML = '';
});

describe('ActionButtons', () => {
  const item = { id: '1', name: 'x' };

  test('renders a status badge', () => {
    render(<ActionButtons item={item} status="paid" showStatus />);
    expect(screen.getByText('مدفوعة')).toBeInTheDocument();
  });

  test('calls onView and onEdit', () => {
    const onView = jest.fn();
    const onEdit = jest.fn();
    render(<ActionButtons item={item} onView={onView} onEdit={onEdit} />);
    fireEvent.click(screen.getByTitle('عرض التفاصيل'));
    expect(onView).toHaveBeenCalledWith(item);
    fireEvent.click(screen.getByTitle('تعديل السجل'));
    expect(onEdit).toHaveBeenCalledWith(item);
  });

  test('opens the delete modal and confirms deletion', async () => {
    const onDelete = jest.fn(async () => {});
    render(<ActionButtons item={item} onDelete={onDelete} />);
    fireEvent.click(screen.getByTitle('حذف'));
    const confirm = screen.getAllByRole('button').find((b) => b.textContent === 'حذف');
    fireEvent.click(confirm!);
    expect(onDelete).toHaveBeenCalledWith(item);
  });
});

describe('Pagination', () => {
  test('navigates to a specific page', () => {
    const onPageChange = jest.fn();
    render(<Pagination currentPage={1} totalPages={3} onPageChange={onPageChange} />);
    fireEvent.click(screen.getByText('2'));
    expect(onPageChange).toHaveBeenCalledWith(2);
  });

  test('renders prev/next controls and respects boundaries', () => {
    const onPageChange = jest.fn();
    render(<Pagination currentPage={1} totalPages={5} onPageChange={onPageChange} />);
    const buttons = screen.getAllByRole('button');
    // prev button on page 1 should be disabled or not navigate
    fireEvent.click(buttons[0]);
    expect(onPageChange).not.toHaveBeenCalled();
  });
});
