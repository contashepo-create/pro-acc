'use client';

import React, { type TextareaHTMLAttributes } from 'react';

interface TextareaProps extends TextareaHTMLAttributes<HTMLTextAreaElement> {
  label?: string;
  error?: string;
  helperText?: string;
  showCount?: boolean;
}

export function Textarea({
  label,
  error,
  helperText,
  showCount = false,
  className = '',
  maxLength,
  value,
  id,
  ...props
}: TextareaProps) {
  const textareaId = id || label?.replace(/\s+/g, '-').toLowerCase();
  const charCount = typeof value === 'string' ? value.length : 0;

  return (
    <div className="flex flex-col gap-1.5">
      {label && (
        <label
          htmlFor={textareaId}
          className="text-sm font-medium text-text-secondary"
        >
          {label}
        </label>
      )}
      <textarea
        id={textareaId}
        dir="auto"
        className={`input-base min-h-[80px] resize-y ${
          error ? '!border-danger !shadow-[0_0_0_3px_var(--color-danger-light)]' : ''
        } ${className}`}
        maxLength={maxLength}
        value={value}
        {...props}
      />
      <div className="flex items-center justify-between">
        <div>
          {error && (
            <p className="text-xs text-danger" role="alert">{error}</p>
          )}
          {helperText && !error && (
            <p className="text-xs text-text-muted">{helperText}</p>
          )}
        </div>
        {showCount && maxLength && (
          <span className="text-xs text-text-muted" dir="ltr">
            {charCount}/{maxLength}
          </span>
        )}
      </div>
    </div>
  );
}
