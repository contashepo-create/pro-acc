/**
 * UI component tests for AnnouncementBar dismiss and OverheadSettings add rule.
 * Run via jest -c jest.ui.config.js (jsdom + RTL).
 */
import React from 'react';
import { render, screen, fireEvent } from '@testing-library/react';
import { AnnouncementBar } from '@/components/AnnouncementBar';
import OverheadSettings from '@/components/settings/OverheadSettings';

const fetchMock = jest.fn();
global.fetch = fetchMock as unknown as typeof fetch;

afterEach(() => {
  jest.clearAllMocks();
  document.body.innerHTML = '';
});

describe('AnnouncementBar', () => {
  test('renders an announcement and dismisses it', async () => {
    localStorage.clear();
    fetchMock.mockResolvedValue({
      ok: true,
      json: async () => ({ success: true, data: [{ id: 'a1', title: 'تنويه', body: 'نص', type: 'info', link_url: null, link_text: null, priority: 1 }] }),
    });
    render(<AnnouncementBar />);
    expect(await screen.findByText('تنويه')).toBeInTheDocument();
    fireEvent.click(screen.getAllByRole('button')[0]);
    expect(screen.queryByText('تنويه')).not.toBeInTheDocument();
  });
});

describe('OverheadSettings add rule', () => {
  test('adds a new rule via POST', async () => {
    fetchMock
      .mockResolvedValueOnce({ ok: true, json: async () => ({ success: true, data: { rows: [] } }) }) // load
      .mockResolvedValueOnce({ ok: true, json: async () => ({ success: true, data: {} }) }) // add
      .mockResolvedValueOnce({ ok: true, json: async () => ({ success: true, data: { rows: [] } }) }); // reload
    render(<OverheadSettings />);
    const input = screen.getByPlaceholderText('مثال: مصاريف الإدارة');
    fireEvent.change(input, { target: { value: 'مصاريف إدارية' } });
    fireEvent.click(screen.getByText('إضافة القاعدة'));
    expect(fetchMock).toHaveBeenCalledWith('/api/projects/overhead', expect.objectContaining({ method: 'POST' }));
  });
});
