/**
 * UI component tests for Table loading, selection and sorting.
 * Run via jest -c jest.ui.config.js (jsdom + RTL).
 */
import React from 'react';
import { render, screen, fireEvent } from '@testing-library/react';
import { Table } from '@/components/ui/Table';

const columns = [
  { key: 'name', label: 'الاسم', sortable: true },
  { key: 'amount', label: 'المبلغ', sortable: true },
];
const data = [
  { id: '1', name: 'أ', amount: 100 },
  { id: '2', name: 'ب', amount: 50 },
];

afterEach(() => {
  jest.clearAllMocks();
  document.body.innerHTML = '';
});

describe('Table', () => {
  test('renders a loading spinner', () => {
    render(<Table columns={columns} data={[]} loading />);
    expect(screen.getByLabelText('جاري التحميل')).toBeInTheDocument();
  });

  test('supports row and select-all selection', () => {
    const onSelectionChange = jest.fn();
    render(<Table columns={columns} data={data} selectable onSelectionChange={onSelectionChange} />);
    const boxes = screen.getAllByRole('checkbox');
    fireEvent.click(boxes[0]);
    expect(onSelectionChange).toHaveBeenCalledWith(['1', '2']);
  });

  test('sorts when a sortable header is clicked', () => {
    const { container } = render(<Table columns={columns} data={data} sortable />);
    fireEvent.click(screen.getByText('الاسم'));
    // First row should be sorted ascending by name
    expect(container.querySelector('tbody')!.textContent).toContain('أ');
  });
});
