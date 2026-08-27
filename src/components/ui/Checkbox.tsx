'use client';

import React, { useRef, useEffect } from 'react';

interface CheckboxProps {
  checked: boolean;
  onChange: (checked: boolean) => void;
  label?: string;
  indeterminate?: boolean;
  disabled?: boolean;
  className?: string;
}

export function Checkbox({
  checked,
  onChange,
  label,
  indeterminate = false,
  disabled = false,
  className = '',
}: CheckboxProps) {
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (inputRef.current) {
      inputRef.current.indeterminate = indeterminate;
    }
  }, [indeterminate]);

  return (
    <label
      className={`inline-flex items-center gap-2.5 ${
        disabled ? 'opacity-50 cursor-not-allowed' : 'cursor-pointer'
      } ${className}`}
    >
      <div className="relative flex-shrink-0">
        <input
          ref={inputRef}
          type="checkbox"
          className="sr-only"
          checked={checked}
          disabled={disabled}
          onChange={(e) => onChange(e.target.checked)}
        />
        <div
          className={`w-5 h-5 rounded border-2 transition-colors duration-150 flex items-center justify-center ${
            checked || indeterminate
              ? 'bg-accent border-accent'
              : 'bg-transparent border-border hover:border-border-light'
          } ${disabled ? '' : 'hover:border-accent/50'}`}
        >
          {(checked || indeterminate) && (
            <svg
              className="w-3 h-3 text-white"
              viewBox="0 0 12 12"
              fill="none"
              stroke="currentColor"
              strokeWidth="2.5"
              strokeLinecap="round"
              strokeLinejoin="round"
            >
              {indeterminate ? (
                <path d="M2 6h8" />
              ) : (
                <path d="M2 6l3 3 5-5" />
              )}
            </svg>
          )}
        </div>
      </div>
      {label && (
        <span className="text-sm text-text-primary select-none">{label}</span>
      )}
    </label>
  );
}
