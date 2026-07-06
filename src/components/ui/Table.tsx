'use client';

import React, { useState } from 'react';
import { ChevronUp, ChevronDown, ChevronsUpDown } from 'lucide-react';
import { Spinner } from './Spinner';
import { EmptyState } from './EmptyState';

export interface TableColumn<T> {
  key: string;
  label: string;
  sortable?: boolean;
  render?: (row: T, index: number) => React.ReactNode;
}

interface TableProps<T> {
  columns: TableColumn<T>[];
  data: T[];
  sortable?: boolean;
  selectable?: boolean;
  selectedIds?: string[];
  onSelectionChange?: (ids: string[]) => void;
  idKey?: string;
  emptyMessage?: string;
  loading?: boolean;
  striped?: boolean;
  onRowClick?: (row: T) => void;
  className?: string;
}

export function Table<T extends Record<string, unknown>>({
  columns,
  data,
  sortable: globallySortable = false,
  selectable = false,
  selectedIds = [],
  onSelectionChange,
  idKey = 'id',
  emptyMessage = 'لا توجد بيانات',
  loading = false,
  striped = false,
  onRowClick,
  className = '',
}: TableProps<T>) {
  const [sortKey, setSortKey] = useState<string | null>(null);
  const [sortDir, setSortDir] = useState<'asc' | 'desc'>('asc');

  const handleSort = (key: string) => {
    if (sortKey === key) {
      setSortDir(sortDir === 'asc' ? 'desc' : 'asc');
    } else {
      setSortKey(key);
      setSortDir('asc');
    }
  };

  const isAllSelected =
    data.length > 0 && data.every((row) => selectedIds.includes(String(row[idKey])));

  const handleSelectAll = () => {
    if (isAllSelected) {
      onSelectionChange?.([]);
    } else {
      onSelectionChange?.(data.map((row) => String(row[idKey])));
    }
  };

  const handleSelectRow = (id: string) => {
    const newSelected = selectedIds.includes(id)
      ? selectedIds.filter((sid) => sid !== id)
      : [...selectedIds, id];
    onSelectionChange?.(newSelected);
  };

  const sortedData = [...data].sort((a, b) => {
    if (!sortKey) return 0;
    const aVal = a[sortKey];
    const bVal = b[sortKey];
    if (aVal == null) return 1;
    if (bVal == null) return -1;
    const cmp =
      typeof aVal === 'number' && typeof bVal === 'number'
        ? aVal - bVal
        : String(aVal).localeCompare(String(bVal));
    return sortDir === 'asc' ? cmp : -cmp;
  });

  if (loading) {
    return (
      <div className="table-container">
        <div className="flex items-center justify-center py-16">
          <Spinner size="lg" />
        </div>
      </div>
    );
  }

  if (data.length === 0) {
    return (
      <div className="table-container">
        <EmptyState title={emptyMessage} description="" />
      </div>
    );
  }

  return (
    <div className={`table-container ${className}`}>
      <table>
        <thead>
          <tr>
            {selectable && (
              <th className="!w-10">
                <input
                  type="checkbox"
                  checked={isAllSelected}
                  onChange={handleSelectAll}
                  className="rounded border-border bg-bg-secondary accent-accent cursor-pointer"
                />
              </th>
            )}
            {columns.map((col) => (
              <th
                key={col.key}
                className={`${col.sortable && globallySortable ? 'cursor-pointer select-none hover:text-text-primary' : ''}`}
                onClick={() => {
                  if (col.sortable && globallySortable) handleSort(col.key);
                }}
              >
                <span className="inline-flex items-center gap-1.5">
                  {col.label}
                  {col.sortable && globallySortable && (
                    <span className="inline-flex flex-col">
                      {sortKey === col.key ? (
                        sortDir === 'asc' ? (
                          <ChevronUp className="w-3.5 h-3.5" />
                        ) : (
                          <ChevronDown className="w-3.5 h-3.5" />
                        )
                      ) : (
                        <ChevronsUpDown className="w-3.5 h-3.5 opacity-50" />
                      )}
                    </span>
                  )}
                </span>
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {sortedData.map((row, index) => {
            const rowId = String(row[idKey]);
            return (
              <tr
                key={rowId}
                className={`${onRowClick ? 'cursor-pointer' : ''} ${
                  striped && index % 2 === 1 ? 'bg-bg-secondary/30' : ''
                } ${selectedIds.includes(rowId) ? 'bg-accent-light/20' : ''}`}
                onClick={() => onRowClick?.(row)}
              >
                {selectable && (
                  <td className="!w-10" onClick={(e) => e.stopPropagation()}>
                    <input
                      type="checkbox"
                      checked={selectedIds.includes(rowId)}
                      onChange={() => handleSelectRow(rowId)}
                      className="rounded border-border bg-bg-secondary accent-accent cursor-pointer"
                    />
                  </td>
                )}
                {columns.map((col) => (
                  <td key={col.key}>
                    {col.render ? col.render(row, index) : String(row[col.key] ?? '')}
                  </td>
                ))}
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}
