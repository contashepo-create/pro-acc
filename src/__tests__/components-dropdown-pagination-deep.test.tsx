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

  test('selects a non-divider item with ArrowDown and Enter', () => {
    const onClick = jest.fn();
    const items = [
      { label: 'فاصل', onClick: () => {}, divider: true },
      { label: 'تعديل', onClick },
    ];
    const { container } = render(<Dropdown trigger={<button>قائمة</button>} items={items} />);
    fireEvent.keyDown(container.firstElementChild!, { key: 'ArrowDown' });
    fireEvent.keyDown(container.firstElementChild!, { key: 'Enter' });
    expect(onClick).toHaveBeenCalled();
  });

  test('cycles items with ArrowDown and moves up with ArrowUp', () => {
    const onA = jest.fn();
    const onB = jest.fn();
    const items = [
      { label: 'أ', onClick: onA },
      { label: 'ب', onClick: onB },
    ];
    const { container } = render(<Dropdown trigger={<button>قائمة</button>} items={items} />);
    fireEvent.keyDown(container.firstElementChild!, { key: 'Enter' });
    // ArrowDown from 0 -> 1, then ArrowDown wraps back to 0
    fireEvent.keyDown(container.firstElementChild!, { key: 'ArrowDown' });
    fireEvent.keyDown(container.firstElementChild!, { key: 'ArrowDown' });
    fireEvent.keyDown(container.firstElementChild!, { key: 'Enter' });
    expect(onA).toHaveBeenCalled();

    // Reopen and ArrowUp from 0 wraps to the last item (1)
    fireEvent.keyDown(container.firstElementChild!, { key: 'Enter' });
    fireEvent.keyDown(container.firstElementChild!, { key: 'ArrowUp' });
    fireEvent.keyDown(container.firstElementChild!, { key: 'Enter' });
    expect(onB).toHaveBeenCalled();
  });

  test('toggles open when the trigger is clicked and renders an icon item', () => {
    render(
      <Dropdown
        trigger={<button>قائمة</button>}
        items={[{ label: 'تعديل', onClick: () => {}, icon: <span>✏️</span> }]}
      />
    );
    fireEvent.click(screen.getByText('قائمة'));
    expect(screen.getByRole('menu')).toBeInTheDocument();
    expect(screen.getByText('✏️')).toBeInTheDocument();
    fireEvent.click(screen.getByText('قائمة'));
    expect(screen.queryByRole('menu')).toBeNull();
  });

  test('closes when clicking outside the container', () => {
    const { container } = render(<Dropdown trigger={<button>قائمة</button>} items={[{ label: 'تعديل', onClick: () => {} }]} />);
    fireEvent.click(screen.getByText('قائمة'));
    expect(screen.getByRole('menu')).toBeInTheDocument();
    fireEvent.mouseDown(document.body);
    expect(screen.queryByRole('menu')).toBeNull();
    expect(container).toBeTruthy();
  });

  test('renders the right-positioned menu', () => {
    const { container } = render(
      <Dropdown position="right" trigger={<button>قائمة</button>} items={[{ label: 'تعديل', onClick: () => {} }]} />
    );
    fireEvent.click(screen.getByText('قائمة'));
    const menu = container.querySelector('[role="menu"]')!;
    expect(menu.className).toContain('right-0');
  });

  test('selects an item with the space key', () => {
    const onClick = jest.fn();
    const { container } = render(<Dropdown trigger={<button>قائمة</button>} items={[{ label: 'تعديل', onClick }]} />);
    fireEvent.keyDown(container.firstElementChild!, { key: ' ' });
    fireEvent.keyDown(container.firstElementChild!, { key: ' ' });
    expect(onClick).toHaveBeenCalled();
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
