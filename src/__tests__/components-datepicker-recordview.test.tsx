/**
 * UI component tests for DatePicker and RecordViewModal.
 * Run via jest -c jest.ui.config.js (jsdom + RTL).
 */
import React from 'react';
import { render, screen, fireEvent } from '@testing-library/react';
import { DatePicker } from '@/components/ui/DatePicker';
import { RecordViewModal, buildRecordEntries } from '@/components/ui/RecordViewModal';

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

  test('uses the number fallback title when there is no name', () => {
    render(<RecordViewModal isOpen onClose={() => {}} record={{ number: 42, amount: 5 }} />);
    expect(screen.getByText('معاينة سجل رقم #42')).toBeInTheDocument();
  });

  test('uses the generic title when there is neither name nor number', () => {
    render(<RecordViewModal isOpen onClose={() => {}} record={{ amount: 5 }} />);
    expect(screen.getByText('معاينة تفاصيل السجل')).toBeInTheDocument();
  });

  test('formats enums, dates, booleans and currency values', () => {
    render(
      <RecordViewModal
        isOpen
        onClose={() => {}}
        record={{
          status: 'paid',
          date: '2026-03-10T00:00:00',
          total: 1250.5,
          is_active: true,
        }}
      />
    );
    expect(screen.getByText('مدفوعة بالكامل ✅')).toBeInTheDocument();
    expect(screen.getByText('نعم / مفعّل')).toBeInTheDocument();
  });

  test('renders a provided footer instead of the default', () => {
    render(
      <RecordViewModal
        isOpen
        onClose={() => {}}
        record={{ name: 'سجل' }}
        footer={<button>مخصص</button>}
      />
    );
    expect(screen.getByText('مخصص')).toBeInTheDocument();
    expect(screen.queryByText('إغلاق المعاينة')).not.toBeInTheDocument();
  });
});

describe('buildRecordEntries', () => {
  test('filters hidden, empty, relation and foreign-key fields', () => {
    const entries = buildRecordEntries({
      id: 'u1',
      company_id: 'c1',
      created_by: 'x',
      name: 'عميل',
      nested_obj: { x: 1 },
      client_id: 'uuid',
      empty_field: '',
      null_field: null,
      items: [],
    });
    expect(entries).toEqual([['name', 'عميل']]);
  });

  test('promotes embedded relation objects into readable fields', () => {
    const entries = buildRecordEntries({
      invoice_number: 'INV-1',
      contacts: { name: 'شركة الأمل' },
      journal_entries: { number: 7 },
    });
    expect(entries).toEqual([
      ['invoice_number', 'INV-1'],
      ['contact_name', 'شركة الأمل'],
      ['journal_number', 7],
    ]);
  });

  test('does not duplicate a field that already exists explicitly', () => {
    const entries = buildRecordEntries({
      contact_name: 'مباشر',
      contacts: { name: 'مكرر' },
      projects: { name: 'مشروع' },
    });
    expect(entries).toEqual([
      ['contact_name', 'مباشر'],
      ['project_name', 'مشروع'],
    ]);
  });
});
