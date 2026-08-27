import { NextRequest } from 'next/server';
import { error, handleApiError } from '@/lib/api-helpers';
import { getSupabase } from '@/lib/supabase-client';
import { toCsvCell } from '@/lib/csv-export';
import {
  EXPORT_TABLES, LEGACY_TABLE_ALIAS, getReport, resolveReportIds,
  requiredLookupTables, LOOKUP_DEFS, buildLookupMaps, shapeReportHeaders,
  shapeReportRow, type Row, type ReportSpec,
} from '@/lib/report-export';

/** The report ids this endpoint may produce (documented API contract). */
export { EXPORT_TABLES, LEGACY_TABLE_ALIAS };

const sb = () => getSupabase();

/**
 * Company-scoped PROFESSIONAL REPORT export (Excel / CSV) — the only
 * self-service data download the platform offers.
 *
 * Policy (قرار مالك المنصة):
 *  - NO whole-database dump and NO raw table copies: the client receives
 *    formatted ACCOUNTING REPORTS — Arabic business headers, real names
 *    (clients/projects/accounts) instead of raw ids, translated statuses,
 *    and no internal/sensitive columns (no settings, notifications, hashes).
 *  - NO restore path exists anywhere: these files can never be uploaded back
 *    into the platform. Re-entering data is manual entry only.
 *  - Company isolation: every source table and every lookup is filtered by
 *    the session company.
 */

/** The ONLY formats this endpoint may produce. */
const ALLOWED_FORMATS = new Set(['csv', 'excel']);

async function fetchCompanyRows(companyId: string, table: string, orderBy = 'id', select = '*'): Promise<Row[]> {
  const s = sb();
  const rows: Row[] = [];
  const pageSize = 1000;
  for (let offset = 0; ; offset += pageSize) {
    const { data, error: pageError } = await s.from(table)
      .select(select)
      .eq('company_id', companyId)
      .order(orderBy, { ascending: true })
      .range(offset, offset + pageSize - 1);
    if (pageError) {
      const missing = pageError.code === '42P01' || /does not exist|Could not find/i.test(pageError.message || '');
      if (missing) return [];
      throw new Error(`تعذر تصدير التقرير ${table}: ${pageError.message}`);
    }
    const page = (data || []) as Row[];
    rows.push(...page);
    if (page.length < pageSize) break;
  }
  return rows;
}

async function buildLookupMapsFor(specs: ReportSpec[], companyId: string) {
  const needed = requiredLookupTables(specs, companyId);
  const fetched: Record<string, Row[]> = {};
  await Promise.all(needed.map(async ({ table }) => {
    const def = LOOKUP_DEFS[table];
    if (!def) { fetched[table] = []; return; }
    fetched[table] = await fetchCompanyRows(companyId, table, 'id', `id, ${def.fields}`);
  }));
  return buildLookupMaps(fetched);
}

function reportSection(spec: ReportSpec, headers: string[], records: string[][], companyName: string, stamp: string): string {
  const lines: string[] = [];
  lines.push(toCsvCell(`تقرير: ${spec.title} — شركة: ${companyName} — تاريخ التصدير: ${stamp} — عدد السجلات: ${records.length}`));
  lines.push(headers.map(toCsvCell).join(','));
  for (const rec of records) lines.push(rec.map(toCsvCell).join(','));
  lines.push('');
  return lines.join('\r\n');
}

function escapeHtml(v: unknown): string {
  if (v === null || v === undefined) return '';
  return String(v).replace(/[&<>"']/g, (c) =>
    ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c] as string));
}

function reportsToExcelHtml(sections: { spec: ReportSpec; headers: string[]; records: string[][] }[], companyName: string, stamp: string): string {
  const sheets = sections.map(({ spec, headers, records }) => {
    const head = `<tr style="background:#1e3a5f;color:#ffffff;font-weight:bold;">${headers.map((h) => `<th style="padding:6px;border:1px solid #6b7280;">${escapeHtml(h)}</th>`).join('')}</tr>`;
    const body = records.map((rec, i) =>
      `<tr style="background:${i % 2 ? '#e8edf2' : '#ffffff'};color:#111827;">${rec.map((cell) => `<td style="padding:4px;border:1px solid #d1d5db;">${escapeHtml(cell)}</td>`).join('')}</tr>`
    ).join('');
    return `<h2 style="font-family:Arial;color:#111827;">${escapeHtml(spec.title)}</h2>` +
      `<p style="font-family:Arial;color:#4b5563;font-size:12px;">شركة: ${escapeHtml(companyName)} — تاريخ التصدير: ${escapeHtml(stamp)} — عدد السجلات: ${records.length}</p>` +
      `<table dir="rtl" border="1" cellspacing="0" style="font-family:Arial;font-size:12px;border-collapse:collapse;">${head}${body}</table><br/>`;
  }).join('');
  return `<html xmlns:o="urn:schemas-microsoft-com:office:office" xmlns:x="urn:schemas-microsoft-com:office:excel">` +
    `<head><meta charset="utf-8"/></head><body dir="rtl">${sheets}</body></html>`;
}

function fileResponse(content: string, filename: string, contentType: string, bom = false) {
  const body = bom ? '\uFEFF' + content : content;
  return new Response(body, {
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
    // Fail closed on anything that is not explicitly csv/excel — JSON dumps of
    // the database are permanently off the menu.
    const format = typeof body.format === 'string' ? body.format : 'csv';
    if (!ALLOWED_FORMATS.has(format)) {
      return error('صيغة التصدير المتاحة هي Excel أو CSV فقط (لا تتوفر نسخة من قاعدة البيانات)', 400);
    }
    const requested: string[] = Array.isArray(body.tables) ? body.tables : [];
    const ids = requested.length ? resolveReportIds(requested) : [...EXPORT_TABLES];
    if (!ids.length) return error('لا توجد تقارير صالحة للتصدير', 400);
    const specs = ids.map((id) => getReport(id)).filter((s): s is ReportSpec => Boolean(s));

    const s = sb();
    const { data: company } = await s.from('companies').select('name').eq('id', auth.companyId).maybeSingle();
    const companyName = String((company as Row | null)?.name ?? 'الشركة');
    const stamp = new Date().toISOString().slice(0, 10);

    const maps = await buildLookupMapsFor(specs, auth.companyId);

    const sections: { spec: ReportSpec; headers: string[]; records: string[][] }[] = [];
    for (const spec of specs) {
      const rows = await fetchCompanyRows(auth.companyId, spec.table, spec.orderBy ?? 'id');
      sections.push({
        spec,
        headers: shapeReportHeaders(spec),
        records: rows.map((row) => shapeReportRow(spec, row, maps)),
      });
    }

    if (format === 'excel') {
      return fileResponse(reportsToExcelHtml(sections, companyName, stamp), `company-reports-${stamp}.xls`, 'application/vnd.ms-excel');
    }
    const csv = sections.map(({ spec, headers, records }) => reportSection(spec, headers, records, companyName, stamp)).join('\r\n');
    // UTF-8 BOM so Excel opens Arabic headers correctly.
    return fileResponse(csv, `company-reports-${stamp}.csv`, 'text/csv; charset=utf-8', true);
  } catch (e) {
    return handleApiError(e);
  }
}
