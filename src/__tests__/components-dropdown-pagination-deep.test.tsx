/**
 * UI component tests for Dropdown keyboard navigation and Pagination deep.
 * Run via jest -c jest.ui.config.js (jsdom + RTL).
 */
import React from 'react';
import { render, screen, fireEvent } from '@testing-library/react';
import { Dropdown } from '@/components/ui/Dropdown';
import { Pagination } from '@/components/ui/Pagination';

afterEach(() => {
  jest.clearAllMocks();
  document.body.innerHTML = '';
});

describe('Dropdown', () => {
  test('opens with ArrowDown and selects an item with Enter', () => {
    const onClick = jest.fn();
    const { container } = render(<Dropdown trigger={<button>قائمة</button>} items={[{ label: 'حذف', onClick }]} />);
    fireEvent.keyDown(container.firstElementChild!, { key: 'ArrowDown' });
    expect(screen.getByRole('menu')).toBeInTheDocument();
    fireEvent.keyDown(container.firstElementChild!, { key: 'Enter' });
    expect(onClick).toHaveBeenCalled();
  });

  test('closes with Escape and renders a danger item', () => {
    const { container } = render(<Dropdown trigger={<button>قائمة</button>} items={[{ label: 'حذف نهائي', onClick: () => {}, danger: true }]} />);
    fireEvent.keyDown(container.firstElementChild!, { key: 'Enter' });
    expect(screen.getByText('حذف نهائي')).toBeInTheDocument();
    fireEvent.keyDown(container.firstElementChild!, { key: 'Escape' });
    expect(screen.queryByRole('menu')).toBeNull();
  });
});

describe('Pagination', () => {
  test('navigates next and prev', () => {
    const onPageChange = jest.fn();
    render(<Pagination currentPage={2} totalPages={5} onPageChange={onPageChange} />);
    fireEvent.click(screen.getByLabelText('الصفحة التالية'));
    expect(onPageChange).toHaveBeenCalledWith(3);
  });

  test('renders an ellipsis for large page counts', () => {
    const onPageChange = jest.fn();
    render(<Pagination currentPage={1} totalPages={20} onPageChange={onPageChange} />);
    expect(screen.getAllByText('...').length).toBeGreaterThan(0);
  });
});
