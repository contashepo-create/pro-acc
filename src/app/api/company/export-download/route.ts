import { NextRequest } from 'next/server';
import { success, error, handleApiError } from '@/lib/api-helpers';
import { getSupabase } from '@/lib/supabase-client';
import { toCsvCell, recordsToCsv } from '@/lib/csv-export';

const sb = () => getSupabase();

/** Company-scoped tables available for self-service export (no admin/system tables). */
export const EXPORT_TABLES = [
  'accounts', 'journal_entries', 'journal_lines', 'clients', 'contacts',
  'invoices', 'invoice_items', 'quotations', 'quotation_items',
  'purchase_invoices', 'custodies', 'custody_transactions',
  'employees', 'employee_advances', 'projects', 'project_expenses',
  'fixed_assets', 'inventory', 'inventory_transactions', 'warehouses',
  'branches', 'banks', 'cash_transactions', 'bonds', 'vouchers',
  'budgets', 'cost_centers', 'notifications', 'settings', 'tax_returns',
];

type Row = Record<string, unknown>;

async function fetchCompanyTable(companyId: string, table: string): Promise<Row[]> {
  const s = sb();
  const rows: Row[] = [];
  const pageSize = 1000;
  for (let offset = 0; ; offset += pageSize) {
    const { data, error: pageError } = await s.from(table)
      .select('*')
      .eq('company_id', companyId)
      .order('id', { ascending: true })
      .range(offset, offset + pageSize - 1);
    if (pageError) {
      const missing = pageError.code === '42P01' || /does not exist|Could not find/i.test(pageError.message || '');
      if (missing) return [];
      throw new Error(`تعذر تصدير الجدول ${table}: ${pageError.message}`);
    }
    const page = (data || []) as Row[];
    rows.push(...page);
    if (page.length < pageSize) break;
  }
  return rows;
}

function tablesToCsvBundle(bundle: Record<string, Row[]>): string {
  const parts: string[] = [];
  for (const [name, rows] of Object.entries(bundle)) {
    parts.push(`# ${name} (${rows.length})`);
    if (rows.length) parts.push(recordsToCsv(rows).trimEnd());
    else parts.push('(لا توجد سجلات)');
    parts.push('');
  }
  return parts.join('\r\n');
}

function tablesToExcelHtml(bundle: Record<string, Row[]>): string {
  const sheets = Object.entries(bundle).map(([name, rows]) => {
    const head = rows.length
      ? `<tr>${Object.keys(rows[0]).map((h) => `<th>${escapeHtml(h)}</th>`).join('')}</tr>`
      : '';
    const body = rows.map((r) =>
      `<tr>${Object.keys(rows[0] ?? {}).map((h) => `<td>${escapeHtml(r[h])}</td>`).join('')}</tr>`
    ).join('');
    return `<h3>${escapeHtml(name)} (${rows.length})</h3><table border="1">${head}${body}</table><br/>`;
  }).join('');
  return `<html xmlns:o="urn:schemas-microsoft-com:office:office" xmlns:x="urn:schemas-microsoft-com:office:excel"><head><meta charset="utf-8"/></head><body>${sheets}</body></html>`;
}

function escapeHtml(v: unknown): string {
  if (v === null || v === undefined) return '';
  return String(v).replace(/[&<>"']/g, (c) =>
    ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c] as string));
}

function fileResponse(content: string, filename: string, contentType: string) {
  return new Response(content, {
    status: 200,
    headers: {
      'Content-Type': contentType,
      'Content-Disposition': `attachment; filename="${filename}"`,
      'Cache-Control': 'no-store',
    },
  });
}

export async function POST(req: NextRequest) {
  try {
    const { requireApiAuth } = await import('@/lib/api-helpers');
    const auth = await requireApiAuth(req, { skipModuleGuard: true });
    if (auth.role !== 'admin') return error('تصدير بيانات الشركة متاح لمدير الشركة فقط', 403);

    const body = await req.json().catch(() => ({}));
    const format: string = body.format === 'excel' ? 'excel' : body.format === 'json' ? 'json' : 'csv';
    const requested: string[] = Array.isArray(body.tables) ? body.tables : [];
    const tables = (requested.length ? requested : EXPORT_TABLES).filter((t) => EXPORT_TABLES.includes(t));
    if (!tables.length) return error('لا توجد جداول صالحة للتصدير', 400);

    const bundle: Record<string, Row[]> = {};
    for (const t of tables) bundle[t] = await fetchCompanyTable(auth.companyId, t);

    const stamp = new Date().toISOString().slice(0, 10);
    if (format === 'csv') {
      return fileResponse(tablesToCsvBundle(bundle), `company-export-${stamp}.csv`, 'text/csv; charset=utf-8');
    }
    if (format === 'excel') {
      return fileResponse(tablesToExcelHtml(bundle), `company-export-${stamp}.xls`, 'application/vnd.ms-excel');
    }
    return fileResponse(JSON.stringify(bundle, null, 2), `company-export-${stamp}.json`, 'application/json; charset=utf-8');
  } catch (e) {
    return handleApiError(e);
  }
}
