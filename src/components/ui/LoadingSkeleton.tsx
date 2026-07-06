'use client';

import React from 'react';

interface LoadingSkeletonProps {
  variant?: 'text' | 'card' | 'table' | 'chart' | 'custom';
  width?: string | number;
  height?: string | number;
  count?: number;
  className?: string;
}

const variantDefaults: Record<string, { width: string; height: string }> = {
  text: { width: '100%', height: '16px' },
  card: { width: '100%', height: '160px' },
  table: { width: '100%', height: '40px' },
  chart: { width: '100%', height: '200px' },
  custom: { width: '100%', height: '100%' },
};

export function LoadingSkeleton({
  variant = 'text',
  width,
  height,
  count = 1,
  className = '',
}: LoadingSkeletonProps) {
  const w = width ?? variantDefaults[variant].width;
  const h = height ?? variantDefaults[variant].height;

  const style: React.CSSProperties = {
    width: typeof w === 'number' ? `${w}px` : w,
    height: typeof h === 'number' ? `${h}px` : h,
  };

  if (variant === 'table') {
    return (
      <div className="flex flex-col gap-2">
        {Array.from({ length: count }).map((_, i) => (
          <div
            key={i}
            className="skeleton rounded-md"
            style={
              i === 0
                ? { width: '100%', height: '24px', marginBottom: '4px' }
                : { width: '100%', height: '36px' }
            }
          />
        ))}
      </div>
    );
  }

  if (variant === 'card') {
    return (
      <div className="card p-4 space-y-3">
        <div className="skeleton" style={{ width: '60%', height: '20px' }} />
        <div className="skeleton" style={{ width: '40%', height: '14px' }} />
        <div className="skeleton" style={{ width: '100%', height: '80px' }} />
      </div>
    );
  }

  if (variant === 'chart') {
    return (
      <div className="card p-4">
        <div className="flex items-end gap-2 h-full" style={{ height: typeof h === 'number' ? `${h - 48}px` : '152px' }}>
          {Array.from({ length: 8 }).map((_, i) => (
            <div
              key={i}
              className="skeleton flex-1"
              style={{ height: `${30 + Math.random() * 70}%` }}
            />
          ))}
        </div>
        <div className="flex justify-between mt-3">
          {Array.from({ length: 8 }).map((_, i) => (
            <div key={i} className="skeleton" style={{ width: '30px', height: '12px' }} />
          ))}
        </div>
      </div>
    );
  }

  return (
    <div className={`flex flex-col gap-2 ${className}`}>
      {Array.from({ length: count }).map((_, i) => (
        <div key={i} className="skeleton" style={i > 0 ? { ...style, width: `${70 + Math.random() * 30}%` } : style} />
      ))}
    </div>
  );
}
