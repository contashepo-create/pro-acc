/**
 * UI component tests for Barcode, ActionButtons, RecordViewModal, Select,
 * AdPopup.
 * Run via jest -c jest.ui.config.js (jsdom + RTL).
 */
import React from 'react';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { Barcode } from '@/components/ui/Barcode';
import { ActionButtons } from '@/components/ui/ActionButtons';
import { RecordViewModal } from '@/components/ui/RecordViewModal';
import { Select } from '@/components/ui/Select';
import { AdPopup } from '@/components/AdPopup';

const JsBarcodeMock = jest.fn();
jest.mock('jsbarcode', () => (...a: any[]) => JsBarcodeMock(...a));
jest.mock('@/lib/print', () => ({ openPrintWindow: () => ({ ok: true }) }));

const fetchMock = jest.fn();
global.fetch = fetchMock as any;

beforeEach(() => {
  localStorage.clear();
  sessionStorage.clear();
});
afterEach(() => {
  jest.clearAllMocks();
  document.body.innerHTML = '';
});

describe('Barcode', () => {
  test('generates a barcode for the value', () => {
    render(<Barcode value="ABC123" />);
    expect(JsBarcodeMock).toHaveBeenCalled();
  });
});

describe('ActionButtons', () => {
  test('renders edit and delete and fires callbacks', () => {
    const onEdit = jest.fn();
    const onDelete = jest.fn();
    render(<ActionButtons item={{ id: '1', name: 'x' }} onEdit={onEdit} onDelete={onDelete} />);
    fireEvent.click(screen.getByText('Edit'));
    expect(onEdit).toHaveBeenCalled();
  });
});

describe('RecordViewModal', () => {
  test('renders a record field value', () => {
    render(<RecordViewModal isOpen onClose={() => {}} record={{ name: 'عميل', amount: 100 }} title="تفاصيل" />);
    expect(screen.getByText('عميل')).toBeInTheDocument();
  });
});

describe('Select', () => {
  test('opens and selects an option', async () => {
    const onChange = jest.fn();
    render(<Select options={[{ value: 'a', label: 'الأول' }, { value: 'b', label: 'الثاني' }]} onChange={onChange} />);
    fireEvent.click(screen.getByText('اختر...'));
    const option = await screen.findByText('الأول');
    fireEvent.click(option);
    expect(onChange).toHaveBeenCalledWith('a');
  });
});

describe('AdPopup', () => {
  test('renders a fetched popup ad', async () => {
    fetchMock.mockResolvedValue({
      ok: true,
      json: async () => ({ success: true, data: [{ id: 'p1', title: 'عرض', body: 'نص', type: 'promotion', link_url: null, link_text: null, priority: 1 }] }),
    });
    render(<AdPopup />);
    expect(await screen.findByText('عرض', {}, { timeout: 3000 })).toBeInTheDocument();
  });
});
