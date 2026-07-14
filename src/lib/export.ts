/**
 * Report Export Utilities — PDF + Excel + CSV
 * 
 * Provides functions to export financial reports in multiple formats.
 * Client-side only (uses browser APIs for file download).
 */

// ===== Excel Export =====

export interface ExcelColumn {
  header: string;
  key: string;
  width?: number;
  type?: 'string' | 'number' | 'date' | 'currency';
}

/**
 * Export data to Excel (.xlsx) file
 * Uses dynamic import to avoid SSR issues
 */
export async function exportToExcel(
  data: Record<string, unknown>[],
  columns: ExcelColumn[],
  filename: string,
  sheetName = 'Report'
): Promise<void> {
  const XLSX = await import('xlsx');

  // Build worksheet data
  const wsData = [
    columns.map(col => col.header),
    ...data.map(row =>
      columns.map(col => {
        const value = row[col.key];
        if (col.type === 'currency') {
          return typeof value === 'number' ? value : parseFloat(String(value)) || 0;
        }
        if (col.type === 'date' && value) {
          return new Date(String(value)).toLocaleDateString('ar-SA');
        }
        return value ?? '';
      })
    ),
  ];

  const ws = XLSX.utils.aoa_to_sheet(wsData);

  // Set column widths
  ws['!cols'] = columns.map(col => ({ wch: col.width || 20 }));

  // Create workbook
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, sheetName);

  // Add RTL direction for Arabic
  ws['!sheetViews'] = [{ rightToLeft: true }];

  // Download
  XLSX.writeFile(wb, `${filename}.xlsx`);
}

/**
 * Export to CSV (simpler, universal format)
 */
export function exportToCSV(
  data: Record<string, unknown>[],
  columns: ExcelColumn[],
  filename: string
): void {
  const BOM = '\uFEFF'; // UTF-8 BOM for Excel Arabic support
  const header = columns.map(c => c.header).join(',');
  const rows = data.map(row =>
    columns.map(col => {
      const value = String(row[col.key] ?? '');
      // Escape CSV special chars
      return value.includes(',') || value.includes('"') || value.includes('\n')
        ? `"${value.replace(/"/g, '""')}"`
        : value;
    }).join(',')
  );

  const csvContent = BOM + [header, ...rows].join('\n');
  downloadFile(csvContent, `${filename}.csv`, 'text/csv;charset=utf-8');
}

// ===== PDF Export =====

/**
 * Export data to PDF with Arabic support
 * Uses jsPDF + autotable
 */
export async function exportToPDF(
  data: Record<string, unknown>[],
  columns: ExcelColumn[],
  filename: string,
  options: {
    title?: string;
    subtitle?: string;
    company?: string;
    date?: string;
  } = {}
): Promise<void> {
  const { default: jsPDF } = await import('jspdf');
  await import('jspdf-autotable');

  const doc = new jsPDF({ orientation: 'landscape', unit: 'mm', format: 'a4' });
  const pageWidth = doc.internal.pageSize.getWidth();

  // Header
  doc.setFontSize(16);
  if (options.company) {
    doc.text(options.company, pageWidth / 2, 15, { align: 'center' });
  }

  doc.setFontSize(14);
  doc.text(options.title || 'Report', pageWidth / 2, 25, { align: 'center' });

  if (options.subtitle || options.date) {
    doc.setFontSize(10);
    doc.setTextColor(100);
    const sub = [options.subtitle, options.date, `Generated: ${new Date().toLocaleDateString()}`].filter(Boolean).join(' | ');
    doc.text(sub, pageWidth / 2, 32, { align: 'center' });
    doc.setTextColor(0);
  }

  // Table
  const headers = columns.map(c => c.header);
  const rows = data.map(row =>
    columns.map(col => {
      const value = row[col.key];
      if (col.type === 'currency') {
        return typeof value === 'number' ? value.toFixed(2) : String(value || '0.00');
      }
      if (col.type === 'date' && value) {
        return new Date(String(value)).toLocaleDateString('en-CA'); // YYYY-MM-DD for PDF
      }
      return String(value ?? '');
    })
  );

  // Use autotable (accessed via jsPDF prototype)
  (doc as unknown as { autoTable: (options: Record<string, unknown>) => void }).autoTable({
    head: [headers],
    body: rows,
    startY: 38,
    styles: { fontSize: 8, cellPadding: 2 },
    headStyles: { fillColor: [41, 128, 185], textColor: 255, fontStyle: 'bold' },
    alternateRowStyles: { fillColor: [245, 245, 245] },
    margin: { left: 10, right: 10 },
  });

  // Footer with page numbers
  const pageCount = (doc as unknown as { internal: { pageCount: number } }).internal.pageCount;
  for (let i = 1; i <= pageCount; i++) {
    (doc as unknown as { setPagePage: (p: number) => void }).setPagePage?.(i);
    doc.setFontSize(8);
    doc.setTextColor(150);
    doc.text(
      `Page ${i} of ${pageCount}`,
      pageWidth / 2, doc.internal.pageSize.getHeight() - 10,
      { align: 'center' }
    );
  }

  doc.save(`${filename}.pdf`);
}

// ===== Utility =====

function downloadFile(content: string, filename: string, mimeType: string): void {
  const blob = new Blob([content], { type: mimeType });
  const url = URL.createObjectURL(blob);
  const link = window.document.createElement('a');
  link.href = url;
  link.download = filename;
  window.document.body.appendChild(link);
  link.click();
  window.document.body.removeChild(link);
  URL.revokeObjectURL(url);
}

/**
 * Export helper that shows format selection
 * Returns the function to call based on format choice
 */
export function getExportFunction(format: 'excel' | 'csv' | 'pdf') {
  switch (format) {
    case 'excel': return exportToExcel;
    case 'csv': return exportToCSV;
    case 'pdf': return exportToPDF;
  }
}
