'use client';

import React, { useState, useRef, useEffect, type SelectHTMLAttributes } from 'react';
import { createPortal } from 'react-dom';
import { ChevronDown, Search, X } from 'lucide-react';

interface SelectOption {
  value: string;
  label: string;
  disabled?: boolean;
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
  const [mounted, setMounted] = useState(false);
  const [coords, setCoords] = useState<{ top: number; left: number; width: number }>({ top: 0, left: 0, width: 0 });

  const containerRef = useRef<HTMLDivElement>(null);
  const buttonRef = useRef<HTMLButtonElement>(null);
  const dropdownRef = useRef<HTMLDivElement>(null);
  const searchInputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    setMounted(true);
  }, []);

  const selectedOption = options.find((opt) => opt.value === value);

  const filteredOptions = searchable
    ? options.filter((opt) =>
        opt.label.toLowerCase().includes(searchQuery.toLowerCase())
      )
    : options;

  const updateCoords = () => {
    if (!buttonRef.current) return;
    const rect = buttonRef.current.getBoundingClientRect();
    const width = Math.min(Math.max(rect.width, 280), window.innerWidth - 24);
    let left = rect.left;
    if (left + width > window.innerWidth - 12) left = window.innerWidth - width - 12;
    if (left < 12) left = 12;
    const spaceBelow = window.innerHeight - rect.bottom;
    const menuH = Math.min(320, window.innerHeight - 24);
    const top = spaceBelow < 220 && rect.top > spaceBelow
      ? Math.max(12, rect.top - menuH)
      : Math.min(rect.bottom + 4, window.innerHeight - 80);
    setCoords({ top, left, width });
  };

  useEffect(() => {
    const handleClickOutside = (e: MouseEvent) => {
      const target = e.target as Node;
      if (
        containerRef.current &&
        !containerRef.current.contains(target) &&
        dropdownRef.current &&
        !dropdownRef.current.contains(target)
      ) {
        setIsOpen(false);
        setSearchQuery('');
      }
    };
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, []);

  useEffect(() => {
    if (isOpen) {
      updateCoords();
      window.addEventListener('resize', updateCoords);
      window.addEventListener('scroll', updateCoords, true);
      return () => {
        window.removeEventListener('resize', updateCoords);
        window.removeEventListener('scroll', updateCoords, true);
      };
    }
  }, [isOpen]);

  useEffect(() => {
    if (isOpen && searchable && searchInputRef.current) {
      searchInputRef.current.focus();
    }
  }, [isOpen, searchable]);

  const handleSelect = (opt: SelectOption) => {
    if (opt.disabled) return;
    onChange?.(opt.value);
    setIsOpen(false);
    setSearchQuery('');
  };

  const selectId = id || label?.replace(/\s+/g, '-').toLowerCase();

  const dropdownMenu = (
    <div
      ref={dropdownRef}
      style={{
        position: 'fixed',
        top: `${coords.top}px`,
        left: `${coords.left}px`,
        width: `${coords.width}px`,
        maxHeight: 'min(320px, 70dvh)',
        zIndex: 99999,
      }}
      className="bg-bg-card border border-border rounded-xl shadow-2xl overflow-hidden animate-in fade-in duration-150"
    >
      {searchable && (
        <div className="p-2 border-b border-border bg-bg-secondary">
          <div className="relative">
            <Search className="absolute right-2.5 top-1/2 -translate-y-1/2 w-4 h-4 text-text-muted" />
            <input
              ref={searchInputRef}
              type="text"
              dir="auto"
              className="input-base !pr-8 text-sm bg-bg-primary"
              placeholder="بحث بالرمز أو الاسم..."
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
            />
            {searchQuery && (
              <button
                type="button"
                className="absolute left-2 top-1/2 -translate-y-1/2 text-text-muted hover:text-text-primary"
                onClick={() => setSearchQuery('')}
              >
                <X className="w-3.5 h-3.5" />
              </button>
            )}
          </div>
        </div>
      )}
      <div className="max-h-64 overflow-y-auto divide-y divide-border/20">
        {filteredOptions.length === 0 ? (
          <div className="p-4 text-sm text-text-muted text-center">
            لا توجد نتائج مطابقة
          </div>
        ) : (
          filteredOptions.map((opt) => (
            <button
              key={opt.value}
              type="button"
              disabled={opt.disabled}
              className={`w-full text-right px-3.5 py-2.5 text-sm transition-colors flex items-center justify-between ${
                opt.disabled
                  ? 'opacity-50 cursor-not-allowed bg-bg-secondary/50 text-text-muted font-bold'
                  : opt.value === value
                  ? 'bg-accent/10 text-accent font-semibold'
                  : 'text-text-primary hover:bg-bg-hover'
              }`}
              onClick={() => handleSelect(opt)}
            >
              <span>{opt.label}</span>
              {opt.value === value && <span className="text-accent text-xs">✓</span>}
            </button>
          ))
        )}
      </div>
    </div>
  );

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
          ref={buttonRef}
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
          <span className="truncate">{selectedOption ? selectedOption.label : placeholder}</span>
          <ChevronDown
            className={`w-4 h-4 text-text-muted transition-transform duration-200 shrink-0 ${
              isOpen ? 'rotate-180' : ''
            }`}
          />
        </button>

        {isOpen && mounted && typeof document !== 'undefined'
          ? createPortal(dropdownMenu, document.body)
          : null}
      </div>
      {error && (
        <p className="text-xs text-danger" role="alert">{error}</p>
      )}
    </div>
  );
}
