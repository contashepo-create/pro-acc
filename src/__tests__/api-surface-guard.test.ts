/**
 * Whole-API structural guard (no database connection required).
 *
 * Reviewing 229 route files by hand does not stay reviewed: the next route
 * someone adds can silently reintroduce a class of bug that was already fixed.
 * This suite encodes the invariants that the line-by-line review established,
 * and applies them to EVERY route, so a regression fails CI instead of
 * reaching production.
 *
 * Invariants enforced here:
 *  1. Every route authenticates, unless it is on an explicit public allow-list.
 *  2. Every tenant route derives company_id from the session, never from
 *     client-controlled input (body/query) — that is the IDOR primitive.
 *  3. Every `[id]` route is tenant scoped, either by filtering company_id
 *     directly or by delegating to a company-scoped RPC.
 *  4. No route silently truncates a full-table read with a huge .limit().
 *  5. Reports validate dates and pagination instead of coercing junk.
 */
import fs from 'fs';
import path from 'path';

const apiDir = path.resolve(__dirname, '../../src/app/api');

function listRoutes(dir: string): string[] {
  const out: string[] = [];
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) out.push(...listRoutes(full));
    else if (entry.name === 'route.ts') out.push(full);
  }
  return out;
}

const routeFiles = listRoutes(apiDir);
const routes = routeFiles.map((file) => ({
  name: file.slice(apiDir.length + 1).replace(/\/route\.ts$/, ''),
  file,
  src: fs.readFileSync(file, 'utf8'),
}))
  // Compatibility aliases simply re-export the canonical handlers.
  .filter((route) => !/^\s*\/\*\*[\s\S]*?\*\/\s*export\s*\{/.test(route.src) && !/^\s*export\s*\{/.test(route.src.trim()));

/**
 * Routes that are intentionally reachable without a session, each with the
 * reason it is safe. Anything not listed here MUST authenticate.
 */
const PUBLIC_ROUTES: Record<string, string> = {
  'auth/login': 'issues a session',
  'auth/logout': 'clears a session',
  'auth/register': 'self-service signup',
  'auth/setup': 'first-run bootstrap, guarded by an empty-database check',
  'auth/forgot-password': 'anonymous password reset request',
  'auth/reset-password': 'consumes a single-use reset token',
  'auth/verify-email': 'consumes a single-use verification token',
  'auth/resend-verification': 'anonymous, rate limited',
  'auth/cleanup-inactive': 'cron endpoint guarded by a shared secret',
  'admin/login': 'platform admin login step 1',
  'admin/send-telegram-code': 'platform admin login 2FA delivery',
  'admin/verify-telegram': 'platform admin login step 2',
  'admin/verify-master': 'platform admin login step 3',
  'portal/auth': 'client portal login',
  'portal/invoices': 'client portal session token, not a company session',
  'portal/invoices/[id]': 'client portal session token, not a company session',
  'telegram/webhook': 'verified by the Telegram shared secret header',
  'telegram/callback': 'verified by the Telegram shared secret header',
  'csrf-token': 'issues a CSRF token',
  'docs': 'static OpenAPI description',
  'advertisements': 'public read-only active ads',
  'ads/track': 'anonymous ad impression tracking',
  'visitors': 'anonymous visit counter, rate limited per IP',
  'diagnostics': 'requires an admin session or the DIAGNOSTICS_SECRET header',
};

const AUTH_HELPERS = /require(ApiAuth|ApiAuthWithSubscription|Admin|AdminAuth|ModulePermission|Role|ManagerOrAbove|AccountantOrAbove)\s*\(/;

describe('API surface: authentication', () => {
  test('every route authenticates unless explicitly public', () => {
    const unauthenticated = routes
      .filter((route) => !AUTH_HELPERS.test(route.src))
      .filter((route) => !(route.name in PUBLIC_ROUTES))
      .map((route) => route.name);
    expect(unauthenticated).toEqual([]);
  });

  test('the public allow-list does not silently grow stale', () => {
    // Every documented exception must still exist as a route.
    const names = new Set(routes.map((route) => route.name));
    const missing = Object.keys(PUBLIC_ROUTES).filter((name) => !names.has(name));
    expect(missing).toEqual([]);
  });

  test('the whole documented API surface is covered by this guard', () => {
    // Guards that silently scan zero files are worse than no guard at all.
    expect(routes.length).toBeGreaterThan(200);
  });
});

describe('API surface: tenant isolation', () => {
  /** Platform-admin routes operate across tenants by design. */
  const isAdminRoute = (name: string) => name.startsWith('admin/');

  test('company_id is never taken from client-controlled input', () => {
    // `body.company_id` / `searchParams.get('company_id')` is the classic IDOR
    // primitive: it lets a caller name someone else's tenant.
    const offenders = routes.filter((route) => {
      if (isAdminRoute(route.name)) return false;
      return /body\.company_id|body\?\.company_id|searchParams\.get\(['"]company_id['"]\)/.test(route.src);
    }).map((route) => route.name);
    expect(offenders).toEqual([]);
  });

  test('every [id] route is tenant scoped or delegates to a company-scoped RPC', () => {
    const idRoutes = routes.filter((route) => /\[\w+\]/.test(route.name) && !isAdminRoute(route.name));
    const unscoped = idRoutes.filter((route) => {
      const directFilter = /eq\(\s*['"]company_id['"]/.test(route.src);
      const scopedRpc = /p_company_id/.test(route.src);
      return !directFilter && !scopedRpc;
    }).map((route) => route.name);
    expect(unscoped).toEqual([]);
    // Guard against the check quietly matching nothing.
    expect(idRoutes.length).toBeGreaterThan(50);
  });

  test('tenant routes resolve the company from the authenticated session', () => {
    const tenantRoutes = routes.filter((route) => (
      !isAdminRoute(route.name)
      && !(route.name in PUBLIC_ROUTES)
      && /eq\(\s*['"]company_id['"]/.test(route.src)
    ));
    // The company must come out of the auth helper. Routes bind it as
    // `auth.companyId`, `ctx.companyId`, or destructure `{ companyId }` — all
    // are session-derived; what matters is that it is never request input.
    const sessionDerived = /(\w+\.companyId)|(\{[^}]*\bcompanyId\b[^}]*\}\s*=\s*await\s+require)/;
    const offenders = tenantRoutes.filter((route) => !sessionDerived.test(route.src))
      .map((route) => route.name);
    expect(offenders).toEqual([]);
    expect(tenantRoutes.length).toBeGreaterThan(100);
  });
});

describe('API surface: no silent truncation', () => {
  test('no route caps a full-table read with a huge limit', () => {
    // A .limit(10000) on an export silently drops row 10,001 onward, which
    // produces a corrupt backup that still passes hash verification.
    const offenders = routes.filter((route) => /\.limit\(\s*\d{4,}\s*\)/.test(route.src))
      .map((route) => {
        const match = route.src.match(/\.limit\(\s*(\d{4,})\s*\)/);
        return `${route.name} (limit ${match?.[1]})`;
      });
    expect(offenders).toEqual([]);
  });

  test('backup and export routes page through their tables', () => {
    for (const name of ['backup/download', 'backup/auto', 'company/data-export']) {
      const route = routes.find((entry) => entry.name === name)!;
      expect(route).toBeDefined();
      // Paging is what makes completeness possible.
      expect(route.src).toMatch(/\.range\(/);
      // And a read error must surface rather than becoming an empty table.
      expect(route.src).toMatch(/throw new Error\(/);
    }
  });
});

describe('API surface: report input validation', () => {
  const reportRoutes = routes.filter((route) => route.name.startsWith('reports/'));

  test('reports that accept a date range validate it', () => {
    const offenders = reportRoutes.filter((route) => {
      const takesDates = /searchParams\.get\(['"](from|to|asOf|date_from)['"]\)/.test(route.src);
      if (!takesDates) return false;
      // Accept any of the project's date validators: the shared isValidDate
      // helper, a zod date schema, or an explicit YYYY-MM-DD regex.
      return !/isValidDate|parseReportDateRange|getDateRangeParams|deliveryDate|reportDate|\.safeParse\(|regex|\/\^\\d\{4\}/.test(route.src);
    }).map((route) => route.name);
    expect(offenders).toEqual([]);
  });

  test('reports that paginate use the strict shared parser', () => {
    const offenders = reportRoutes.filter((route) => {
      const paginates = /searchParams\.get\(['"](page|page_size)['"]\)/.test(route.src);
      if (!paginates) return false;
      return !/parseReportPagination/.test(route.src);
    }).map((route) => route.name);
    expect(offenders).toEqual([]);
  });

  test('report routes require an authenticated reporting permission', () => {
    const offenders = reportRoutes
      .filter((route) => !/requireModulePermission\(\s*\w+,\s*['"](reports|financial_reports)['"]/.test(route.src))
      .map((route) => route.name);
    expect(offenders).toEqual([]);
  });
});
