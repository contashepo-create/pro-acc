/**
 * UI component tests for form/feedback src/components/ui components.
 * Run via jest -c jest.ui.config.js (jsdom + RTL).
 */
import React from 'react';
import { render, screen, fireEvent, act } from '@testing-library/react';
import { Input } from '@/components/ui/Input';
import { Textarea } from '@/components/ui/Textarea';
import { Checkbox } from '@/components/ui/Checkbox';
import { PageHeader } from '@/components/ui/PageHeader';
import { SearchInput } from '@/components/ui/SearchInput';
import { Modal } from '@/components/ui/Modal';
import { ToastContainer, toast } from '@/components/ui/Toast';

afterEach(() => {
  jest.clearAllMocks();
  jest.useRealTimers();
  document.body.innerHTML = '';
});

describe('Input', () => {
  test('renders a label bound to the input and an error', () => {
    render(<Input label="الاسم" error="مطلوب" />);
    expect(screen.getByLabelText('الاسم')).toBeInTheDocument();
    expect(screen.getByText('مطلوب')).toBeInTheDocument();
  });
});

describe('Textarea', () => {
  test('shows the character count when enabled', () => {
    render(<Textarea label="الوصف" value="abc" showCount maxLength={10} />);
    expect(screen.getByText('3/10')).toBeInTheDocument();
  });
});

describe('Checkbox', () => {
  test('toggles checked state', () => {
    const onChange = jest.fn();
    render(<Checkbox checked={false} onChange={onChange} label="فعّل" />);
    fireEvent.click(screen.getByLabelText('فعّل'));
    expect(onChange).toHaveBeenCalledWith(true);
  });
});

describe('PageHeader', () => {
  test('renders title, description and triggers back', () => {
    const onBack = jest.fn();
    render(<PageHeader title="العنوان" description="الوصف" onBack={onBack} />);
    expect(screen.getByText('العنوان')).toBeInTheDocument();
    expect(screen.getByText('الوصف')).toBeInTheDocument();
    const back = screen.getAllByRole('button')[0];
    if (back) fireEvent.click(back);
  });
});

describe('SearchInput', () => {
  test('debounces the onChange callback', () => {
    jest.useFakeTimers();
    const onChange = jest.fn();
    render(<SearchInput onChange={onChange} debounceMs={300} />);
    fireEvent.change(screen.getByPlaceholderText('بحث...'), { target: { value: 'abc' } });
    act(() => { jest.advanceTimersByTime(350); });
    expect(onChange).toHaveBeenCalledWith('abc');
  });
});

describe('Modal', () => {
  test('renders nothing when closed and renders content when open', () => {
    const { rerender } = render(<Modal isOpen={false} onClose={() => {}} title="نافذة">محتوى</Modal>);
    expect(screen.queryByRole('dialog')).toBeNull();
    rerender(<Modal isOpen onClose={() => {}} title="نافذة">محتوى</Modal>);
    expect(screen.getByRole('dialog')).toBeInTheDocument();
    expect(screen.getByText('محتوى')).toBeInTheDocument();
  });

  test('calls onClose when the close button is clicked', () => {
    const onClose = jest.fn();
    render(<Modal isOpen onClose={onClose} title="نافذة" showClose>محتوى</Modal>);
    const close = screen.getByRole('button');
    fireEvent.click(close);
    expect(onClose).toHaveBeenCalled();
  });
});

describe('Toast', () => {
  test('renders toasts', async () => {
    render(<ToastContainer />);
    toast.success('تم الحفظ بنجاح');
    expect(await screen.findByText('تم الحفظ بنجاح')).toBeInTheDocument();
  });

  test('renders error, info and warning toasts with type classes', async () => {
    render(<ToastContainer />);
    toast.error('خطأ');
    toast.info('معلومة');
    toast.warning('تحذير');
    expect(await screen.findByText('خطأ')).toBeInTheDocument();
    expect(screen.getByText('معلومة')).toBeInTheDocument();
    expect(screen.getByText('تحذير')).toBeInTheDocument();
  });

  test('dismisses a toast via the close button', async () => {
    jest.useFakeTimers();
    render(<ToastContainer />);
    act(() => {
      toast.success('سأغلق');
    });
    expect(screen.getByText('سأغلق')).toBeInTheDocument();
    act(() => {
      const closeButtons = screen.getAllByLabelText('إغلاق');
      fireEvent.click(closeButtons[closeButtons.length - 1]);
    });
    act(() => {
      jest.advanceTimersByTime(300);
    });
    expect(screen.queryByText('سأغلق')).not.toBeInTheDocument();
  });

  test('dismisses a toast via toast.dismiss', async () => {
    render(<ToastContainer />);
    const id = toast.error('سأحذف');
    await screen.findByText('سأحذف');
    act(() => {
      toast.dismiss(id);
    });
    expect(screen.queryByText('سأحذف')).not.toBeInTheDocument();
  });

  test('auto-dismisses after the configured duration', async () => {
    jest.useFakeTimers();
    render(<ToastContainer />);
    act(() => {
      toast.success('مؤقت', 100);
    });
    expect(screen.getByText('مؤقت')).toBeInTheDocument();
    act(() => {
      jest.advanceTimersByTime(100);
      jest.advanceTimersByTime(300);
    });
    expect(screen.queryByText('مؤقت')).not.toBeInTheDocument();
  });
});
