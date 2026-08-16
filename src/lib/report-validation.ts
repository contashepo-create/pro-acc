export interface ReportPagination {
  page: number;
  pageSize: number;
}

/** Parse report pagination without silently accepting junk or oversized pages. */
export function parseReportPagination(
  params: URLSearchParams,
  defaults: { pageSize?: number; maxPageSize?: number } = {},
): ReportPagination | null {
  const rawPage = params.get('page');
  const rawPageSize = params.get('page_size');
  if ((rawPage && !/^[1-9]\d{0,8}$/.test(rawPage)) || (rawPageSize && !/^[1-9]\d{0,5}$/.test(rawPageSize))) {
    return null;
  }
  const page = rawPage ? Number(rawPage) : 1;
  const pageSize = rawPageSize ? Number(rawPageSize) : (defaults.pageSize || 100);
  if (!Number.isSafeInteger(page) || !Number.isSafeInteger(pageSize) || pageSize > (defaults.maxPageSize || 500)) return null;
  return { page, pageSize };
}
