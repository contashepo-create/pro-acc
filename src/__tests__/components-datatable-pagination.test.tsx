/**
 * UI component test for DataTable pagination.
 * Run via jest -c jest.ui.config.js (jsdom + RTL).
 */
import React from 'react';
import { render, screen, fireEvent } from '@testing-library/react';
import { DataTable } from '@/components/ui/DataTable';

const columns = [{ key: 'name', label: 'الاسم' }];
const data = [
  { id: '1', name: 'عميل أ' },
  { id: '2', name: 'عميل ب' },
];

afterEach(() => {
  jest.clearAllMocks();
  document.body.innerHTML = '';
});

describe('DataTable pagination', () => {
  test('paginates data when the page size is smaller than the dataset', () => {
    render(<DataTable columns={columns} data={data} pageSize={1} />);
    expect(screen.getByText('عميل أ')).toBeInTheDocument();
    expect(screen.queryByText('عميل ب')).toBeNull();
    fireEvent.click(screen.getByLabelText('الصفحة التالية'));
    expect(screen.getByText('عميل ب')).toBeInTheDocument();
  });
});
