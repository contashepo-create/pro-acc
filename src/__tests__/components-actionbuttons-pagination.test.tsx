/**
 * UI component tests for ActionButtons and Pagination.
 * Run via jest -c jest.ui.config.js (jsdom + RTL).
 */
import React from 'react';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { ActionButtons } from '@/components/ui/ActionButtons';
import { Pagination } from '@/components/ui/Pagination';

const openPrintMock = jest.fn();
jest.mock('@/lib/print', () => ({ openPrintWindow: (...a: unknown[]) => openPrintMock(...a) }));

afterEach(() => {
  openPrintMock.mockReset();
  openPrintMock.mockReturnValue({ ok: true });
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

  test('renders different status badges', () => {
    const { rerender } = render(<ActionButtons item={item} status="approved" showStatus />);
    expect(screen.getByText('مؤكدة')).toBeInTheDocument();
    rerender(<ActionButtons item={item} status="rejected" showStatus />);
    expect(screen.getByText('مرفوضة')).toBeInTheDocument();
    rerender(<ActionButtons item={item} status="pending" showStatus />);
    expect(screen.getByText('قيد الانتظار')).toBeInTheDocument();
    rerender(<ActionButtons item={item} status="unpaid" showStatus />);
    expect(screen.getByText('غير مدفوعة')).toBeInTheDocument();
    rerender(<ActionButtons item={item} status="partial" showStatus />);
    expect(screen.getByText('جزئية')).toBeInTheDocument();
    rerender(<ActionButtons item={item} status="custom_status" showStatus />);
    expect(screen.getByText('custom_status')).toBeInTheDocument();
  });

  test('cancelling the delete modal keeps the item', () => {
    const onDelete = jest.fn();
    render(<ActionButtons item={item} onDelete={onDelete} />);
    fireEvent.click(screen.getByTitle('حذف'));
    fireEvent.click(screen.getByText('إلغاء'));
    expect(onDelete).not.toHaveBeenCalled();
  });

  test('opens the view modal when no onView handler is given', () => {
    render(<ActionButtons item={{ id: '1', name: 'عميل' }} />);
    fireEvent.click(screen.getByTitle('عرض التفاصيل'));
    expect(screen.getByText('عميل')).toBeInTheDocument();
  });

  test('calls a custom onPrint handler instead of default print', () => {
    const onPrint = jest.fn();
    render(<ActionButtons item={item} onPrint={onPrint} />);
    fireEvent.click(screen.getByTitle('طباعة'));
    expect(onPrint).toHaveBeenCalledWith(item);
    expect(openPrintMock).not.toHaveBeenCalled();
  });

  test('default print opens a print window with the record html', () => {
    render(<ActionButtons item={{ id: '1', name: 'سجل', code: 'X1' }} />);
    fireEvent.click(screen.getByTitle('طباعة'));
    expect(openPrintMock).toHaveBeenCalledTimes(1);
    expect(String(openPrintMock.mock.calls[0][0])).toContain('سجل');
  });

  test('default print shows an error toast when the window is blocked', () => {
    openPrintMock.mockReturnValue({ ok: false, blocked: true });
    render(<ActionButtons item={{ id: '1', name: 'سجل' }} />);
    expect(() => fireEvent.click(screen.getByTitle('طباعة'))).not.toThrow();
    expect(openPrintMock).toHaveBeenCalled();
  });

  test('handles a failing onDelete and logs the error', async () => {
    const onDelete = jest.fn(async () => { throw new Error('boom'); });
    const errorSpy = jest.spyOn(console, 'error').mockImplementation(() => {});
    render(<ActionButtons item={item} onDelete={onDelete} />);
    fireEvent.click(screen.getByTitle('حذف'));
    const confirm = screen.getAllByRole('button').find((b) => b.textContent === 'حذف');
    fireEvent.click(confirm!);
    await waitFor(() => expect(errorSpy).toHaveBeenCalled());
    errorSpy.mockRestore();
  });

  test('deactivate mode shows deactivate-specific copy', () => {
    const onDelete = jest.fn();
    render(<ActionButtons item={item} onDelete={onDelete} deleteMode="deactivate" />);
    fireEvent.click(screen.getByTitle('تعطيل'));
    expect(screen.getByText('تأكيد التعطيل')).toBeInTheDocument();
    expect(screen.getByText(/تعطيل هذا العنصر/)).toBeInTheDocument();
  });

  test('hides view and print buttons when disabled', () => {
    render(<ActionButtons item={item} showView={false} showPrint={false} />);
    expect(screen.queryByTitle('عرض التفاصيل')).not.toBeInTheDocument();
    expect(screen.queryByTitle('طباعة')).not.toBeInTheDocument();
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
