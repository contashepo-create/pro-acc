'use client';

import React, { type ReactNode } from 'react';

interface TooltipProps {
  content: string;
  children: ReactNode;
  position?: 'top' | 'bottom' | 'left' | 'right';
  delay?: number;
  className?: string;
}

const positionClasses: Record<string, string> = {
  top: 'bottom-full left-1/2 -translate-x-1/2 mb-2',
  bottom: 'top-full left-1/2 -translate-x-1/2 mt-2',
  left: 'right-full top-1/2 -translate-y-1/2 ml-2',
  right: 'left-full top-1/2 -translate-y-1/2 mr-2',
};

const arrowClasses: Record<string, string> = {
  top: 'top-full left-1/2 -translate-x-1/2 border-l-transparent border-r-transparent border-b-transparent border-t-bg-elevated',
  bottom: 'bottom-full left-1/2 -translate-x-1/2 border-l-transparent border-r-transparent border-t-transparent border-b-bg-elevated',
  left: 'left-full top-1/2 -translate-y-1/2 border-t-transparent border-b-transparent border-r-transparent border-l-bg-elevated',
  right: 'right-full top-1/2 -translate-y-1/2 border-t-transparent border-b-transparent border-l-transparent border-r-bg-elevated',
};

export function Tooltip({
  content,
  children,
  position = 'top',
  delay = 300,
  className = '',
}: TooltipProps) {
  return (
    <div className={`relative group inline-flex ${className}`}>
      {children}
      <div
        className={`absolute z-50 pointer-events-none opacity-0 group-hover:opacity-100 transition-opacity ${positionClasses[position]}`}
        style={{ transitionDelay: `${delay}ms` }}
      >
        <div className="relative">
          <div className="bg-bg-elevated text-text-primary text-xs font-medium px-2.5 py-1.5 rounded-md shadow-dropdown whitespace-nowrap max-w-[240px]">
            {content}
          </div>
          <div
            className={`absolute w-0 h-0 border-4 ${arrowClasses[position]}`}
          />
        </div>
      </div>
    </div>
  );
}
