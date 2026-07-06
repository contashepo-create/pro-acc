'use client';

import React, { useState, useMemo } from 'react';
import {
  Search,
  Download,
  Columns,
  Trash2,
  X,
  CheckSquare,
} from 'lucide-react';
import { Table, type TableColumn } from './Table';
import { Pagination } from './Pagination';
import { Button } from './Button';
import { Dropdown } from './Dropdown';
import { Badge } from './Badge';

interface DataTableProps<T> {
  columns: TableColumn<T>[];
  data: T[];
  idKey?: string;
  pageSize?: number;
  pageSizeOptions?: number[];
  searchable?: boolean;
  searchKeys?: (keyof T)[];
  exportable?: boolean;
  selectable?: boolean;
  onRowClick?: (row: T) => void;
  onSelectionChange?: (ids: string[]) => void;
  onBulkAction?: (action: string, ids: string[]) => void;
  bulkActions?: { label: string; value: string; variant?: 'danger' | 'primary' }[];
  emptyMessage?: string;
  loading?: boolean;
  striped?: boolean;
  className?: string;
}

export function DataTable<T extends Record<string, unknown>>({
  columns,
  data,
  idKey = 'id',
  pageSize: defaultPageSize = 25,
  pageSizeOptions,
  searchable = false,
  searchKeys,
  exportable = false,
  selectable = false,
  onRowClick,
  onSelectionChange,
  onBulkAction,
  bulkActions,
  emptyMessage = 'لا توجد بيانات',
  loading = false,
  striped = false,
  className = '',
}: DataTableProps<T>) {
  const [searchQuery, setSearchQuery] = useState('');
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(defaultPageSize);
  const [selectedIds, setSelectedIds] = useState<string[]>([]);
  const [columnVisibility, setColumnVisibility] = useState<Record<string, boolean>>(
    Object.fromEntries(columns.map((col) => [col.key, true]))
  );

  const filteredData = useMemo(() => {
    if (!searchQuery || !searchKeys) return data;
    const q = searchQuery.toLowerCase();
    return data.filter((row) =>
      searchKeys.some((key) => {
        const val = row[key];
        return val != null && String(val).toLowerCase().includes(q);
      })
    );
  }, [data, searchQuery, searchKeys]);

  const totalPages = Math.max(1, Math.ceil(filteredData.length / pageSize));
  const safePage = Math.min(page, totalPages);

  const paginatedData = useMemo(() => {
    const start = (safePage - 1) * pageSize;
    return filteredData.slice(start, start + pageSize);
  }, [filteredData, safePage, pageSize]);

  const visibleColumns = columns.filter((col) => columnVisibility[col.key] !== false);

  const handleSelectionChange = (ids: string[]) => {
    setSelectedIds(ids);
    onSelectionChange?.(ids);
  };

  const handleExportCSV = () => {
    const headerRow = visibleColumns.map((col) => col.label).join(',');
    const dataRows = filteredData.map((row) =>
      visibleColumns
        .map((col) => {
          const val = col.render
            ? extractTextFromRender(col.render(row, 0))
            : String(row[col.key] ?? '');
          return `"${val.replace(/"/g, '""')}"`;
        })
        .join(',')
    );
    const csv = [headerRow, ...dataRows].join('\n');
    const blob = new Blob(['\uFEFF' + csv], { type: 'text/csv;charset=utf-8;' });
    const link = document.createElement('a');
    link.href = URL.createObjectURL(blob);
    link.download = `export-${Date.now()}.csv`;
    link.click();
    URL.revokeObjectURL(link.href);
  };

  return (
    <div className={`flex flex-col gap-4 ${className}`}>
      <div className="flex items-center justify-between flex-wrap gap-3">
        {searchable && (
          <div className="relative flex-1 max-w-sm">
            <Search className="absolute right-3 top-1/2 -translate-y-1/2 w-4 h-4 text-text-muted pointer-events-none" />
            <input
              type="text"
              dir="auto"
              className="input-base !pr-10"
              placeholder="بحث..."
              value={searchQuery}
              onChange={(e) => {
                setSearchQuery(e.target.value);
                setPage(1);
              }}
            />
            {searchQuery && (
              <button
                className="absolute left-3 top-1/2 -translate-y-1/2 text-text-muted hover:text-text-primary transition-colors"
                onClick={() => {
                  setSearchQuery('');
                  setPage(1);
                }}
                aria-label="مسح البحث"
              >
                <X className="w-4 h-4" />
              </button>
            )}
          </div>
        )}

        <div className="flex items-center gap-2 mr-auto">
          {exportable && (
            <Button
              variant="secondary"
              size="sm"
              leftIcon={<Download className="w-4 h-4" />}
              onClick={handleExportCSV}
            >
              تصدير
            </Button>
          )}

          {columns.length > 0 && (
            <Dropdown
              position="left"
              trigger={
                <Button variant="secondary" size="sm" leftIcon={<Columns className="w-4 h-4" />}>
                  أعمدة
                </Button>
              }
              items={columns.map((col) => ({
                label: col.label,
                onClick: () =>
                  setColumnVisibility((prev) => ({
                    ...prev,
                    [col.key]: !prev[col.key],
                  })),
                icon: (
                  <CheckSquare
                    className={`w-4 h-4 ${
                      columnVisibility[col.key] ? 'text-accent' : 'text-text-muted'
                    }`}
                  />
                ),
              }))}
            />
          )}
        </div>
      </div>

      {selectedIds.length > 0 && bulkActions && bulkActions.length > 0 && (
        <div className="flex items-center gap-2 px-4 py-2 bg-accent-light/30 border border-accent/20 rounded-lg">
          <Badge variant="accent">{selectedIds.length} مختار</Badge>
          {bulkActions.map((action) => (
            <Button
              key={action.value}
              variant={action.variant === 'danger' ? 'danger' : 'secondary'}
              size="sm"
              leftIcon={<Trash2 className="w-3.5 h-3.5" />}
              onClick={() => onBulkAction?.(action.value, selectedIds)}
            >
              {action.label}
            </Button>
          ))}
          <Button
            variant="ghost"
            size="sm"
            onClick={() => handleSelectionChange([])}
          >
            إلغاء التحديد
          </Button>
        </div>
      )}

      <Table
        columns={visibleColumns}
        data={paginatedData}
        idKey={idKey}
        selectable={selectable}
        selectedIds={selectedIds}
        onSelectionChange={handleSelectionChange}
        onRowClick={onRowClick}
        emptyMessage={emptyMessage}
        loading={loading}
        striped={striped}
        sortable
      />

      {totalPages > 1 && (
        <Pagination
          currentPage={safePage}
          totalPages={totalPages}
          onPageChange={setPage}
          pageSize={pageSize}
          onPageSizeChange={(size) => {
            setPageSize(size);
            setPage(1);
          }}
          pageSizeOptions={pageSizeOptions}
          totalItems={filteredData.length}
        />
      )}
    </div>
  );
}

function extractTextFromRender(node: React.ReactNode): string {
  if (node == null) return '';
  if (typeof node === 'string') return node;
  if (typeof node === 'number') return String(node);
  if (React.isValidElement(node)) {
    const element = node as React.ReactElement<{ children?: React.ReactNode }>;
    const children = element.props.children;
    if (children) {
      if (Array.isArray(children)) return children.map(extractTextFromRender).join(' ');
      return extractTextFromRender(children);
    }
    return '';
  }
  if (Array.isArray(node)) return node.map(extractTextFromRender).join(' ');
  return '';
}
