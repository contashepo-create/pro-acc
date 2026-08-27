/**
 * UI component tests for Barcode, ActionButtons, RecordViewModal, Select,
 * AdPopup.
 * Run via jest -c jest.ui.config.js (jsdom + RTL).
 */
import React from 'react';
import { render, screen, fireEvent } from '@testing-library/react';
import { Barcode } from '@/components/ui/Barcode';
import { ActionButtons } from '@/components/ui/ActionButtons';
import { RecordViewModal } from '@/components/ui/RecordViewModal';
import { Select } from '@/components/ui/Select';
import { AdPopup } from '@/components/AdPopup';

const JsBarcodeMock = jest.fn();
jest.mock('jsbarcode', () => (...a: unknown[]) => JsBarcodeMock(...a));
jest.mock('@/lib/print', () => ({ openPrintWindow: () => ({ ok: true }) }));

const fetchMock = jest.fn();
global.fetch = fetchMock as unknown as typeof fetch;

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
    fireEvent.click(screen.getByTitle('تعديل السجل'));
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
  const ad = { id: 'p1', title: 'عرض', body: 'نص', type: 'promotion', link_url: null, link_text: null, priority: 1 };

  beforeEach(() => {
    fetchMock.mockResolvedValue({
      ok: true,
      json: async () => ({ success: true, data: [ad] }),
    });
  });

  test('renders a fetched popup ad', async () => {
    render(<AdPopup />);
    expect(await screen.findByText('عرض', {}, { timeout: 3000 })).toBeInTheDocument();
    expect(screen.getByText('نص')).toBeInTheDocument();
  });

  test('dismisses the popup and stores the dismissal', async () => {
    render(<AdPopup />);
    await screen.findByText('عرض', {}, { timeout: 3000 });
    fireEvent.click(screen.getByTitle('إغلاق'));
    expect(screen.queryByText('عرض')).not.toBeInTheDocument();
    const stored = JSON.parse(localStorage.getItem('proacc_dismissed_popups') || '{}');
    expect(stored).toHaveProperty('p1');
  });

  test('does not show a popup again in the same session', async () => {
    sessionStorage.setItem('proacc_popup_shown_this_session', 'true');
    render(<AdPopup />);
    await new Promise((r) => setTimeout(r, 1100));
    expect(screen.queryByText('عرض')).not.toBeInTheDocument();
  });

  test('renders a link button when the ad has a link', async () => {
    fetchMock.mockResolvedValue({
      ok: true,
      json: async () => ({
        success: true,
        data: [{ ...ad, link_url: 'https://example.com', link_text: 'تفاصيل أكثر' }],
      }),
    });
    render(<AdPopup />);
    const link = await screen.findByRole('link', { name: 'تفاصيل أكثر' }, { timeout: 3000 });
    expect(link).toHaveAttribute('href', 'https://example.com');
    expect(link).toHaveAttribute('target', '_blank');
  });

  test('shows the announcement fallback icon for an unknown type', async () => {
    fetchMock.mockResolvedValue({
      ok: true,
      json: async () => ({ success: true, data: [{ ...ad, type: 'unknown_type' }] }),
    });
    render(<AdPopup />);
    expect(await screen.findByText('عرض', {}, { timeout: 3000 })).toBeInTheDocument();
    expect(screen.getByText('unknown_type')).toBeInTheDocument();
  });

  test('skips ads that were already dismissed', async () => {
    localStorage.setItem('proacc_dismissed_popups', JSON.stringify({ p1: new Date(Date.now() + 999999).toISOString() }));
    fetchMock.mockResolvedValue({
      ok: true,
      json: async () => ({
        success: true,
        data: [ad, { id: 'p2', title: 'إعلان ثان', body: 'جسم', type: 'banner', link_url: null, link_text: null, priority: 2 }],
      }),
    });
    render(<AdPopup />);
    expect(await screen.findByText('إعلان ثان', {}, { timeout: 3000 })).toBeInTheDocument();
    expect(screen.queryByText('عرض')).not.toBeInTheDocument();
  });
});
