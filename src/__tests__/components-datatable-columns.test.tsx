/**
 * UI component test for DataTable column visibility toggle.
 * Run via jest -c jest.ui.config.js (jsdom + RTL).
 */
import React from 'react';
import { render, screen, fireEvent } from '@testing-library/react';
import { DataTable } from '@/components/ui/DataTable';

const columns = [{ key: 'name', label: 'الاسم' }, { key: 'total', label: 'الإجمالي' }];
const data = [{ id: '1', name: 'عميل أ', total: 100 }];

afterEach(() => {
  jest.clearAllMocks();
  document.body.innerHTML = '';
});

describe('DataTable column visibility', () => {
  test('hides a column when toggled off', () => {
    render(<DataTable columns={columns} data={data} />);
    expect(screen.getByText('الإجمالي')).toBeInTheDocument();
    fireEvent.click(screen.getByText('أعمدة'));
    fireEvent.click(screen.getByText('الإجمالي', { selector: 'button' }));
    expect(screen.queryByText('100')).toBeNull();
  });
});
