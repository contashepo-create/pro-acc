'use client';

import React, { useState, useRef, useEffect, type ReactNode } from 'react';

interface DropdownItem {
  label: string;
  onClick: () => void;
  icon?: ReactNode;
  divider?: boolean;
  danger?: boolean;
}

interface DropdownProps {
  trigger: ReactNode;
  items: DropdownItem[];
  position?: 'left' | 'right';
  className?: string;
}

export function Dropdown({
  trigger,
  items,
  position = 'left',
  className = '',
}: DropdownProps) {
  const [isOpen, setIsOpen] = useState(false);
  const [activeIndex, setActiveIndex] = useState(-1);
  const containerRef = useRef<HTMLDivElement>(null);
  const menuRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const handleClickOutside = (e: MouseEvent) => {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) {
        setIsOpen(false);
        setActiveIndex(-1);
      }
    };
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, []);

  const handleKeyDown = (e: React.KeyboardEvent) => {
    const validItems = items.filter((i) => !i.divider);
    if (!isOpen) {
      if (e.key === 'Enter' || e.key === ' ' || e.key === 'ArrowDown') {
        e.preventDefault();
        setIsOpen(true);
        setActiveIndex(0);
      }
      return;
    }

    switch (e.key) {
      case 'ArrowDown':
        e.preventDefault();
        setActiveIndex((prev) => (prev + 1) % validItems.length);
        break;
      case 'ArrowUp':
        e.preventDefault();
        setActiveIndex((prev) => (prev - 1 + validItems.length) % validItems.length);
        break;
      case 'Enter':
      case ' ':
        e.preventDefault();
        if (activeIndex >= 0 && validItems[activeIndex]) {
          validItems[activeIndex].onClick();
          setIsOpen(false);
          setActiveIndex(-1);
        }
        break;
      case 'Escape':
        e.preventDefault();
        setIsOpen(false);
        setActiveIndex(-1);
        break;
    }
  };

  const visibleItems = items.filter((i) => !i.divider);

  return (
    <div
      ref={containerRef}
      className={`relative inline-block ${className}`}
      onKeyDown={handleKeyDown}
    >
      <div onClick={() => setIsOpen(!isOpen)}>{trigger}</div>

      {isOpen && (
        <div
          ref={menuRef}
          className={`absolute z-50 mt-1 min-w-[180px] bg-bg-card border border-border rounded-lg shadow-dropdown py-1 ${
            position === 'left' ? 'left-0' : 'right-0'
          }`}
          role="menu"
        >
          {items.map((item, index) => {
            const visibleIdx = visibleItems.indexOf(item);

            if (item.divider) {
              return <div key={index} className="my-1 border-t border-border" />;
            }

            return (
              <button
                key={index}
                role="menuitem"
                className={`w-full text-right px-3 py-2 text-sm flex items-center gap-2 transition-colors ${
                  item.danger
                    ? 'text-danger hover:bg-danger-light'
                    : 'text-text-primary hover:bg-bg-hover'
                } ${activeIndex === visibleIdx ? 'bg-bg-hover' : ''}`}
                onClick={() => {
                  item.onClick();
                  setIsOpen(false);
                  setActiveIndex(-1);
                }}
                onMouseEnter={() => setActiveIndex(visibleIdx)}
              >
                {item.icon && <span className="w-4 h-4 flex-shrink-0">{item.icon}</span>}
                {item.label}
              </button>
            );
          })}
        </div>
      )}
    </div>
  );
}
