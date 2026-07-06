'use client';

import React from 'react';

interface SpinnerProps {
  size?: 'sm' | 'md' | 'lg';
  color?: 'accent' | 'white' | 'muted';
  centered?: boolean;
  className?: string;
}

const sizeMap: Record<string, string> = {
  sm: 'w-4 h-4 border-2',
  md: 'w-6 h-6 border-2',
  lg: 'w-8 h-8 border-[3px]',
};

const colorMap: Record<string, string> = {
  accent: 'border-accent/30 border-t-accent',
  white: 'border-white/30 border-t-white',
  muted: 'border-border border-t-text-muted',
};

export function Spinner({
  size = 'md',
  color = 'accent',
  centered = false,
  className = '',
}: SpinnerProps) {
  const spinner = (
    <div
      className={`animate-spin rounded-full ${sizeMap[size]} ${colorMap[color]} ${className}`}
      role="status"
      aria-label="جاري التحميل"
    />
  );

  if (centered) {
    return (
      <div className="flex items-center justify-center py-8">
        {spinner}
      </div>
    );
  }

  return spinner;
}
