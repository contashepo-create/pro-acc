'use client';

import React, { type ReactNode } from 'react';

interface BadgeProps {
  variant?: 'success' | 'warning' | 'danger' | 'info' | 'accent' | 'default';
  dot?: boolean;
  children: ReactNode;
  className?: string;
}

const variantClasses: Record<string, string> = {
  success: 'badge-success',
  warning: 'badge-warning',
  danger: 'badge-danger',
  info: 'badge-info',
  accent: 'badge-accent',
  default: 'bg-bg-elevated text-text-secondary',
};

const dotColors: Record<string, string> = {
  success: 'bg-success',
  warning: 'bg-warning',
  danger: 'bg-danger',
  info: 'bg-info',
  accent: 'bg-accent',
  default: 'bg-text-muted',
};

export function Badge({
  variant = 'default',
  dot = false,
  children,
  className = '',
}: BadgeProps) {
  return (
    <span className={`badge ${variantClasses[variant]} ${className}`}>
      {dot && (
        <span
          className={`w-1.5 h-1.5 rounded-full ml-1.5 ${dotColors[variant]}`}
        />
      )}
      {children}
    </span>
  );
}
