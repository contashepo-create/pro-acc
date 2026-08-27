'use client';

import React from 'react';
import { Calendar } from 'lucide-react';

interface DatePickerProps {
  label?: string;
  error?: string;
  value?: string;
  onChange?: (value: string) => void;
  min?: string;
  max?: string;
  className?: string;
  id?: string;
  required?: boolean;
}

export function DatePicker({
  label,
  error,
  value,
  onChange,
  min,
  max,
  className = '',
  id,
  required,
}: DatePickerProps) {
  const dateId = id || label?.replace(/\s+/g, '-').toLowerCase();

  return (
    <div className="flex flex-col gap-1.5">
      {label && (
        <label
          htmlFor={dateId}
          className="text-sm font-medium text-text-secondary"
        >
          {label}
          {required && <span className="text-danger mr-1">*</span>}
        </label>
      )}
      <div className="relative">
        <Calendar className="absolute right-3 top-1/2 -translate-y-1/2 w-4 h-4 text-text-muted pointer-events-none" />
        <input
          id={dateId}
          type="date"
          value={value || ''}
          onChange={(e) => onChange?.(e.target.value)}
          min={min}
          max={max}
          required={required}
          className={`input-base !pr-10 ${
            error ? '!border-danger !shadow-[0_0_0_3px_var(--color-danger-light)]' : ''
          } ${className}`}
        />
      </div>
      {error && (
        <p className="text-xs text-danger" role="alert">{error}</p>
      )}
    </div>
  );
}
