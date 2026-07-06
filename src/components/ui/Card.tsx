'use client';

import React, { type ReactNode } from 'react';

interface CardProps {
  children: ReactNode;
  padding?: 'none' | 'sm' | 'md' | 'default';
  hover?: boolean;
  onClick?: () => void;
  className?: string;
  title?: string;
}

const paddingClasses: Record<string, string> = {
  none: '',
  sm: 'p-3',
  md: 'p-4',
  default: 'p-5',
};

export function Card({
  children,
  padding = 'default',
  hover = false,
  onClick,
  className = '',
  title,
}: CardProps) {
  return (
    <div
      className={`card ${paddingClasses[padding]} ${
        hover ? 'card-lift cursor-pointer' : ''
      } ${onClick ? 'cursor-pointer' : ''} ${className}`}
      onClick={onClick}
      role={onClick ? 'button' : undefined}
      tabIndex={onClick ? 0 : undefined}
      onKeyDown={
        onClick
          ? (e) => {
              if (e.key === 'Enter' || e.key === ' ') onClick();
            }
          : undefined
      }
    >
      {title && <h3 className="text-lg font-semibold mb-3">{title}</h3>}
      {children}
    </div>
  );
}
