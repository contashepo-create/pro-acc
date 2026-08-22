/**
 * UI component tests for DataTable selection, export, bulk actions and row click.
 * Run via jest -c jest.ui.config.js (jsdom + RTL).
 */
import React from 'react';
import { render, screen, fireEvent } from '@testing-library/react';
import { DataTable } from '@/components/ui/DataTable';

const columns = [
  { key: 'name', label: 'الاسم' },
  { key: 'total', label: 'الإجمالي' },
];
const data = [
  { id: '1', name: 'عميل أ', total: 100 },
  { id: '2', name: 'عميل ب', total: 200 },
];

afterEach(() => {
  jest.clearAllMocks();
  document.body.innerHTML = '';
});

describe('DataTable features', () => {
  test('fires onRowClick when a row is clicked', () => {
    const onRowClick = jest.fn();
    render(<DataTable columns={columns} data={data} onRowClick={onRowClick} />);
    fireEvent.click(screen.getByText('عميل أ'));
    expect(onRowClick).toHaveBeenCalledWith(data[0]);
  });

  test('selects rows and reports selection', () => {
    const onSelectionChange = jest.fn();
    render(<DataTable columns={columns} data={data} selectable onSelectionChange={onSelectionChange} />);
    const checkboxes = screen.getAllByRole('checkbox');
    // The header select-all plus one checkbox per row.
    fireEvent.click(checkboxes[1]);
    expect(onSelectionChange).toHaveBeenCalled();
  });

  test('renders an export button when exportable', () => {
    render(<DataTable columns={columns} data={data} exportable />);
    expect(screen.getByText('تصدير')).toBeInTheDocument();
  });

  test('runs a bulk action for selected rows', () => {
    const onBulkAction = jest.fn();
    render(
      <DataTable columns={columns} data={data} selectable
        bulkActions={[{ label: 'حذف', value: 'delete', variant: 'danger' }]}
        onBulkAction={onBulkAction} />
    );
    fireEvent.click(screen.getAllByRole('checkbox')[1]);
    fireEvent.click(screen.getByText('حذف'));
    expect(onBulkAction).toHaveBeenCalled();
  });
});
