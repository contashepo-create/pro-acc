'use client';

import React from 'react';

interface TabItem {
  id: string;
  label: string;
  badge?: string | number;
}

interface TabsProps {
  items: TabItem[];
  activeTab: string;
  onChange: (id: string) => void;
  direction?: 'horizontal' | 'vertical';
  className?: string;
}

export function Tabs({
  items,
  activeTab,
  onChange,
  direction = 'horizontal',
  className = '',
}: TabsProps) {
  return (
    <div
      className={`${
        direction === 'vertical'
          ? 'flex flex-col border-l border-border'
          : 'flex border-b border-border overflow-x-auto'
      } ${className}`}
      role="tablist"
    >
      {items.map((item) => {
        const isActive = item.id === activeTab;
        return (
          <button
            key={item.id}
            role="tab"
            aria-selected={isActive}
            className={`relative shrink-0 px-4 py-2.5 text-sm font-medium transition-colors whitespace-nowrap ${
              direction === 'vertical'
                ? 'text-right border-r-2 -mr-[1px]'
                : 'border-b-2 -mb-[1px]'
            } ${
              isActive
                ? 'text-accent border-accent'
                : 'text-text-muted border-transparent hover:text-text-secondary hover:border-border-light'
            }`}
            onClick={() => onChange(item.id)}
          >
            <span className="inline-flex items-center gap-2">
              {item.label}
              {item.badge != null && (
                <span
                  className={`text-xs px-1.5 py-0.5 rounded-full ${
                    isActive
                      ? 'bg-accent-light text-accent'
                      : 'bg-bg-elevated text-text-muted'
                  }`}
                >
                  {item.badge}
                </span>
              )}
            </span>
          </button>
        );
      })}
    </div>
  );
}
