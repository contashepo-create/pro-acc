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
  jest.restoreAllMocks();
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

  function stubAnchor() {
    const clickSpy = jest.fn();
    const realCreateElement = document.createElement.bind(document);
    jest.spyOn(document, 'createElement').mockImplementation((tag: string) => {
      if (String(tag).toLowerCase() === 'a') return { click: clickSpy, href: '', download: '' } as unknown as HTMLElement;
      return realCreateElement(tag);
    });
    return clickSpy;
  }

  test('exports a CSV file and includes header and rows', () => {
    const createObjectURL = jest.fn(() => 'blob:export');
    const revokeObjectURL = jest.fn();
    URL.createObjectURL = createObjectURL;
    URL.revokeObjectURL = revokeObjectURL;
    const clickSpy = stubAnchor();

    render(<DataTable columns={columns} data={data} exportable />);
    fireEvent.click(screen.getByText('تصدير'));
    expect(createObjectURL).toHaveBeenCalled();
    expect(clickSpy).toHaveBeenCalled();
    expect(revokeObjectURL).toHaveBeenCalled();
  });

  test('filters rows by a search key and clears the search', () => {
    render(
      <DataTable columns={columns} data={data} searchable searchKeys={['name']} />
    );
    const search = screen.getByPlaceholderText('بحث...');
    fireEvent.change(search, { target: { value: 'عميل أ' } });
    expect(screen.getByText('عميل أ')).toBeInTheDocument();
    expect(screen.queryByText('عميل ب')).not.toBeInTheDocument();
    fireEvent.click(screen.getByLabelText('مسح البحث'));
    expect(screen.getByText('عميل ب')).toBeInTheDocument();
  });

  test('shows the bulk action bar and clears selection', () => {
    const onBulkAction = jest.fn();
    const onSelectionChange = jest.fn();
    render(
      <DataTable columns={columns} data={data} selectable
        bulkActions={[{ label: 'حذف', value: 'delete', variant: 'danger' }]}
        onBulkAction={onBulkAction}
        onSelectionChange={onSelectionChange} />
    );
    const checkboxes = screen.getAllByRole('checkbox');
    fireEvent.click(checkboxes[1]);
    expect(screen.getByText('1 مختار')).toBeInTheDocument();
    fireEvent.click(screen.getByText('إلغاء التحديد'));
    expect(onSelectionChange).toHaveBeenCalledWith([]);
    expect(screen.queryByText('1 مختار')).not.toBeInTheDocument();
  });

  test('selects all rows via the header checkbox', () => {
    const onSelectionChange = jest.fn();
    render(<DataTable columns={columns} data={data} selectable onSelectionChange={onSelectionChange} />);
    fireEvent.click(screen.getAllByRole('checkbox')[0]);
    expect(onSelectionChange).toHaveBeenCalledWith(['1', '2']);
  });

  test('exports rendered cell text via extractTextFromRender', () => {
    const withRenderColumns = [
      { key: 'name', label: 'الاسم', render: (row: { name?: unknown }) => <b>{String(row.name)}</b> },
    ];
    const createObjectURL = jest.fn(() => 'blob:x');
    URL.createObjectURL = createObjectURL;
    URL.revokeObjectURL = jest.fn();
    const clickSpy = stubAnchor();

    render(<DataTable columns={withRenderColumns} data={data} exportable />);
    fireEvent.click(screen.getByText('تصدير'));
    expect(clickSpy).toHaveBeenCalled();
  });
});
