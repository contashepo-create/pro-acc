/**
 * UI component tests for DatePicker and RecordViewModal.
 * Run via jest -c jest.ui.config.js (jsdom + RTL).
 */
import React from 'react';
import { render, screen, fireEvent } from '@testing-library/react';
import { DatePicker } from '@/components/ui/DatePicker';
import { RecordViewModal } from '@/components/ui/RecordViewModal';

afterEach(() => {
  jest.clearAllMocks();
  document.body.innerHTML = '';
});

describe('DatePicker', () => {
  test('renders a label and fires onChange', () => {
    const onChange = jest.fn();
    render(<DatePicker label="التاريخ" value="2026-01-01" onChange={onChange} required />);
    fireEvent.change(screen.getByDisplayValue('2026-01-01'), { target: { value: '2026-02-01' } });
    expect(onChange).toHaveBeenCalledWith('2026-02-01');
  });
});

describe('RecordViewModal', () => {
  test('renders nothing for a null record', () => {
    const { container } = render(<RecordViewModal isOpen onClose={() => {}} record={null} />);
    expect(container.firstChild).toBeNull();
  });

  test('renders record fields with a display title', () => {
    render(<RecordViewModal isOpen onClose={() => {}} record={{ name: 'عميل', amount: 100 }} />);
    expect(screen.getByText('معاينة: عميل')).toBeInTheDocument();
    expect(screen.getByText('عميل')).toBeInTheDocument();
  });

  test('shows a close button that triggers onClose', () => {
    const onClose = jest.fn();
    render(<RecordViewModal isOpen onClose={onClose} record={{ name: 'عميل' }} />);
    fireEvent.click(screen.getByText('إغلاق المعاينة'));
    expect(onClose).toHaveBeenCalled();
  });
});
