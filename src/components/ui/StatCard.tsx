'use client';

import React, { type ReactNode } from 'react';
import { TrendingUp, TrendingDown } from 'lucide-react';

interface StatCardProps {
  title: string;
  value: string | number;
  trend?: {
    direction: 'up' | 'down';
    percentage: number;
  };
  icon?: ReactNode;
  accentColor?: string;
  onClick?: () => void;
  className?: string;
}

export function StatCard({
  title,
  value,
  trend,
  icon,
  accentColor = 'var(--color-accent)',
  onClick,
  className = '',
}: StatCardProps) {
  return (
    <div
      className={`card p-5 ${onClick ? 'card-lift cursor-pointer' : ''} ${className}`}
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
      <div className="flex items-start justify-between mb-3">
        <span className="text-sm font-medium text-text-secondary">
          {title}
        </span>
        {icon && (
          <span
            className="w-9 h-9 rounded-lg flex items-center justify-center"
            style={{ background: `color-mix(in srgb, ${accentColor} 12%, transparent)`, color: accentColor }}
          >
            {icon}
          </span>
        )}
      </div>

      <div className="flex items-end gap-3">
        <span className="stat-number text-2xl md:text-3xl text-text-primary">
          {value}
        </span>
        {trend && (
          <span
            className={`inline-flex items-center gap-1 text-xs font-medium ${
              trend.direction === 'up' ? 'text-success' : 'text-danger'
            }`}
          >
            {trend.direction === 'up' ? (
              <TrendingUp className="w-3.5 h-3.5" />
            ) : (
              <TrendingDown className="w-3.5 h-3.5" />
            )}
            {trend.percentage}%
          </span>
        )}
      </div>

      <div
        className="mt-3 h-0.5 rounded-full"
        style={{ background: accentColor }}
      />
    </div>
  );
}
