/**
 * UI component test for OverheadSettings.
 * Run via jest -c jest.ui.config.js (jsdom + RTL).
 */
import React from 'react';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import OverheadSettings from '@/components/settings/OverheadSettings';

const fetchMock = jest.fn();
global.fetch = fetchMock as any;

afterEach(() => {
  jest.clearAllMocks();
  document.body.innerHTML = '';
});

describe('OverheadSettings', () => {
  const row = { id: 'r1', name: 'مصاريف الإدارة', allocation_basis: 'direct_cost' as const, rate: 0.1, is_active: true };

  test('loads and renders overhead allocation rules', async () => {
    fetchMock.mockResolvedValue({
      ok: true,
      json: async () => ({ success: true, data: { rows: [row] } }),
    });
    render(<OverheadSettings />);
    expect(await screen.findByText('مصاريف الإدارة')).toBeInTheDocument();
    expect(screen.getByText('مفعّلة')).toBeInTheDocument();
  });

  test('renders a load error and the empty state', async () => {
    fetchMock.mockResolvedValue({ ok: true, json: async () => ({ success: false, message: 'فشل التحميل' }) });
    const { rerender } = render(<OverheadSettings />);
    expect(await screen.findByText('فشل التحميل')).toBeInTheDocument();
    fetchMock.mockResolvedValue({ ok: true, json: async () => ({ success: true, data: { rows: [] } }) });
    rerender(<OverheadSettings />);
    expect(await screen.findByText(/لا توجد قواعد تخصيص/)).toBeInTheDocument();
  });

  test('validates a missing rule name', async () => {
    fetchMock.mockResolvedValue({ ok: true, json: async () => ({ success: true, data: { rows: [] } }) });
    render(<OverheadSettings />);
    await screen.findByText(/لا توجد قواعد تخصيص/);
    fireEvent.click(screen.getByText('إضافة القاعدة'));
    expect(await screen.findByText('اسم القاعدة مطلوب')).toBeInTheDocument();
  });

  test('validates an out-of-range rate', async () => {
    fetchMock.mockResolvedValue({ ok: true, json: async () => ({ success: true, data: { rows: [] } }) });
    render(<OverheadSettings />);
    await screen.findByText(/لا توجد قواعد تخصيص/);
    fireEvent.change(screen.getByLabelText('اسم القاعدة'), { target: { value: 'قاعدة' } });
    fireEvent.change(screen.getByLabelText('النسبة (%)'), { target: { value: '150' } });
    fireEvent.click(screen.getByText('إضافة القاعدة'));
    expect(await screen.findByText(/بين 0 و 100/)).toBeInTheDocument();
  });

  test('adds a rule and shows the toast', async () => {
    const savedRules: any[] = [];
    fetchMock.mockImplementation((_url: string, opts?: any) => {
      if (opts?.method === 'POST') {
        savedRules.push({ id: 'n1', name: 'قاعدة جديدة', allocation_basis: 'direct_cost', rate: 0.15, is_active: true });
        return Promise.resolve({ json: async () => ({ success: true, data: { rows: savedRules } }) });
      }
      return Promise.resolve({ ok: true, json: async () => ({ success: true, data: { rows: savedRules } }) });
    });
    render(<OverheadSettings />);
    await screen.findByText(/لا توجد قواعد تخصيص/);
    fireEvent.change(screen.getByLabelText('اسم القاعدة'), { target: { value: 'قاعدة جديدة' } });
    fireEvent.change(screen.getByLabelText('النسبة (%)'), { target: { value: '15' } });
    fireEvent.click(screen.getByText('إضافة القاعدة'));
    expect(await screen.findByText('قاعدة جديدة')).toBeInTheDocument();
    expect(await screen.findByText('تمت إضافة قاعدة التخصيص')).toBeInTheDocument();
  });

  test('toggles a rule and deletes a rule', async () => {
    fetchMock.mockImplementation((_url: string, opts?: any) => {
      if (opts?.method === 'PUT') return Promise.resolve({ json: async () => ({ success: true }) });
      if (opts?.method === 'DELETE') return Promise.resolve({ json: async () => ({ success: true }) });
      return Promise.resolve({ ok: true, json: async () => ({ success: true, data: { rows: [row] } }) });
    });
    render(<OverheadSettings />);
    await screen.findByText('مصاريف الإدارة');
    fireEvent.click(screen.getByText('إيقاف'));
    expect(await screen.findByText('تم تحديث الحالة')).toBeInTheDocument();
    fireEvent.click(screen.getByTitle('حذف'));
    expect(await screen.findByText('تم حذف القاعدة')).toBeInTheDocument();
  });
});
