'use client';

import React, { useState, useRef, useEffect, type SelectHTMLAttributes } from 'react';
import { ChevronDown, Search, X } from 'lucide-react';

interface SelectOption {
  value: string;
  label: string;
}

interface SelectProps extends Omit<SelectHTMLAttributes<HTMLSelectElement>, 'onChange' | 'onClick'> {
  label?: string;
  options: SelectOption[];
  placeholder?: string;
  error?: string;
  searchable?: boolean;
  onChange?: (value: string) => void;
}

export function Select({
  label,
  options,
  placeholder = 'اختر...',
  error,
  searchable = false,
  onChange,
  value,
  className = '',
  id,
  ...props
}: SelectProps) {
  const [isOpen, setIsOpen] = useState(false);
  const [searchQuery, setSearchQuery] = useState('');
  const containerRef = useRef<HTMLDivElement>(null);
  const searchInputRef = useRef<HTMLInputElement>(null);

  const selectedOption = options.find((opt) => opt.value === value);

  const filteredOptions = searchable
    ? options.filter((opt) =>
        opt.label.toLowerCase().includes(searchQuery.toLowerCase())
      )
    : options;

  useEffect(() => {
    const handleClickOutside = (e: MouseEvent) => {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) {
        setIsOpen(false);
        setSearchQuery('');
      }
    };
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, []);

  useEffect(() => {
    if (isOpen && searchable && searchInputRef.current) {
      searchInputRef.current.focus();
    }
  }, [isOpen, searchable]);

  const handleSelect = (opt: SelectOption) => {
    onChange?.(opt.value);
    setIsOpen(false);
    setSearchQuery('');
  };

  const selectId = id || label?.replace(/\s+/g, '-').toLowerCase();

  return (
    <div className="flex flex-col gap-1.5" ref={containerRef}>
      {label && (
        <label
          htmlFor={selectId}
          className="text-sm font-medium text-text-secondary"
        >
          {label}
        </label>
      )}
      <div className="relative">
        <button
          id={selectId}
          type="button"
          className={`input-base select-base flex items-center justify-between cursor-pointer ${
            error ? '!border-danger !shadow-[0_0_0_3px_var(--color-danger-light)]' : ''
          } ${!value ? 'text-text-muted' : ''} ${className}`}
          onClick={() => setIsOpen(!isOpen)}
          disabled={props.disabled}
          autoFocus={props.autoFocus}
          tabIndex={props.tabIndex}
        >
          <span>{selectedOption ? selectedOption.label : placeholder}</span>
          <ChevronDown
            className={`w-4 h-4 text-text-muted transition-transform duration-200 ${
              isOpen ? 'rotate-180' : ''
            }`}
          />
        </button>

        {isOpen && (
          <div className="absolute z-[100] mt-1 w-full bg-bg-card border border-border rounded-lg shadow-dropdown overflow-hidden">
            {searchable && (
              <div className="p-2 border-b border-border">
                <div className="relative">
                  <Search className="absolute right-2 top-1/2 -translate-y-1/2 w-4 h-4 text-text-muted" />
                  <input
                    ref={searchInputRef}
                    type="text"
                    dir="auto"
                    className="input-base !pr-8 text-sm"
                    placeholder="بحث..."
                    value={searchQuery}
                    onChange={(e) => setSearchQuery(e.target.value)}
                  />
                  {searchQuery && (
                    <button
                      className="absolute left-2 top-1/2 -translate-y-1/2 text-text-muted hover:text-text-primary"
                      onClick={() => setSearchQuery('')}
                    >
                      <X className="w-3.5 h-3.5" />
                    </button>
                  )}
                </div>
              </div>
            )}
            <div className="max-h-60 overflow-y-auto">
              {filteredOptions.length === 0 ? (
                <div className="p-3 text-sm text-text-muted text-center">
                  لا توجد نتائج
                </div>
              ) : (
                filteredOptions.map((opt) => (
                  <button
                    key={opt.value}
                    type="button"
                    className={`w-full text-right px-3 py-2 text-sm transition-colors hover:bg-bg-hover ${
                      opt.value === value
                        ? 'bg-accent-light text-accent'
                        : 'text-text-primary'
                    }`}
                    onClick={() => handleSelect(opt)}
                  >
                    {opt.label}
                  </button>
                ))
              )}
            </div>
          </div>
        )}
      </div>
      {error && (
        <p className="text-xs text-danger" role="alert">{error}</p>
      )}
    </div>
  );
}
