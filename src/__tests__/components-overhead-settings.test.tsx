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
  test('loads and renders overhead allocation rules', async () => {
    fetchMock.mockResolvedValue({
      ok: true,
      json: async () => ({ success: true, data: { rows: [{ id: 'r1', name: 'مصاريف الإدارة', allocation_basis: 'direct_cost', rate: 0.1, is_active: true }] } }),
    });
    render(<OverheadSettings />);
    expect(await screen.findByText('مصاريف الإدارة')).toBeInTheDocument();
    expect(screen.getByText('مفعّلة')).toBeInTheDocument();
  });
});
