'use client';

import React, { useState, useEffect, useRef, useCallback } from 'react';
import { Search, X, Loader2 } from 'lucide-react';

interface SearchInputProps {
  value?: string;
  onChange: (value: string) => void;
  placeholder?: string;
  debounceMs?: number;
  loading?: boolean;
  className?: string;
}

export function SearchInput({
  value = '',
  onChange,
  placeholder = 'بحث...',
  debounceMs = 300,
  loading = false,
  className = '',
}: SearchInputProps) {
  const [localValue, setLocalValue] = useState(value);
  const [prevValue, setPrevValue] = useState(value);
  const debounceRef = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);

  // Sync local state when prop changes (React-recommended pattern instead of useEffect)
  if (value !== prevValue) {
    setPrevValue(value);
    setLocalValue(value);
  }

  const debouncedOnChange = useCallback(
    (val: string) => {
      if (debounceRef.current) clearTimeout(debounceRef.current);
      debounceRef.current = setTimeout(() => {
        onChange(val);
      }, debounceMs);
    },
    [onChange, debounceMs]
  );

  useEffect(() => {
    return () => {
      if (debounceRef.current) clearTimeout(debounceRef.current);
    };
  }, []);

  const handleChange = (val: string) => {
    setLocalValue(val);
    debouncedOnChange(val);
  };

  const handleClear = () => {
    setLocalValue('');
    if (debounceRef.current) clearTimeout(debounceRef.current);
    onChange('');
  };

  return (
    <div className={`relative ${className}`}>
      <Search className="absolute right-3 top-1/2 -translate-y-1/2 w-4 h-4 text-text-muted pointer-events-none" />
      <input
        type="text"
        dir="auto"
        className="input-base !pr-10 !pl-10"
        placeholder={placeholder}
        value={localValue}
        onChange={(e) => handleChange(e.target.value)}
      />
      {loading ? (
        <Loader2 className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-text-muted animate-spin" />
      ) : localValue ? (
        <button
          className="absolute left-3 top-1/2 -translate-y-1/2 text-text-muted hover:text-text-primary transition-colors"
          onClick={handleClear}
          aria-label="مسح البحث"
        >
          <X className="w-4 h-4" />
        </button>
      ) : null}
    </div>
  );
}
