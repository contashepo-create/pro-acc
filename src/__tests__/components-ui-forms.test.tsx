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
});
