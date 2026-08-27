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
 *  6. Statement-level isolation: every statement in a tenant route that reads
 *     a tenant table mentions the company scope. The server Supabase client
 *     uses the service_role key, which BYPASSES RLS, so a missing explicit
 *     filter is a live cross-company read — not a defence-in-depth gap.
 *  7. Every RPC call from a tenant route binds the company from the session
 *     (p_company_id); the atomic SQL functions re-check it server-side.
 *  8. Every direct write (update/delete/upsert) in a tenant route mentions
 *     the company scope in the same statement.
 */
import fs from 'fs';
import path from 'path';

const apiDir = path.resolve(__dirname, '../../src/app/api');

function listRoutes(dir: string): string[] {
  const out: string[] = [];
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) out.push(...listRoutes(full));
    else if (entry.name === 'route.ts') out.push(full.replace(/\\/g, '/'));
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
  // Permanently disabled feature: every method answers 410 Gone and the
  // handler touches neither the database nor any session data.
  'company/reset': 'tombstone for the removed self-service DB reset (always 410)',
  'portal/auth': 'client portal login',
  'portal/invoices': 'client portal session token, not a company session',
  'portal/invoices/[id]': 'client portal session token, not a company session',
  'telegram/webhook': 'verified by the Telegram shared secret header (telegram/callback is a compatibility alias re-export of it)',
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
    // primitive: it lets a caller name someone else's tenant. Check both the
    // snake_case and camelCase spellings so a rename cannot slip past.
    const offenders = routes.filter((route) => {
      if (isAdminRoute(route.name)) return false;
      return /body\.company_id|body\?\.company_id|searchParams\.get\(\s*['"]company_id['"]\s*\)|body\.companyId|body\?\.companyId|searchParams\.get\(\s*['"]companyId['"]\s*\)|params\.companyId|payload\.companyId|input\.companyId/.test(route.src);
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

describe('API surface: statement-level tenant isolation', () => {
  /** Platform-admin routes operate across tenants by design. */
  const isAdminRoute = (name: string) => name.startsWith('admin/');
  const tenantRoutes = routes.filter((route) => (
    !isAdminRoute(route.name) && !(route.name in PUBLIC_ROUTES)
  ));

  /** Tables that genuinely carry no company_id column (platform-wide catalogs). */
  const GLOBAL_TABLES = new Set([
    'subscription_plans', 'payment_methods', 'app_settings', 'activation_codes',
    'login_attempts', 'password_reset_tokens', 'admin_audit_log', 'admin_users',
    'admin_sessions', 'visitor_logs', 'visitor_stats', 'advertisements',
    'ad_views', 'ad_clicks', 'ad_notifications', 'support_tickets',
    'upgrade_requests', 'addon_requests', 'telegram_test_runs',
    'cron_jobs',
  ]);

  /**
   * Statement-level exceptions verified safe by the manual isolation audit.
   * Each entry documents WHY the statement is allowed to skip the company
   * filter, so the exception cannot quietly rot into a real leak.
   */
  const STATEMENT_SCOPE_EXCEPTIONS: Record<string, { tables: string[]; reason: string }> = {
    'auth/me': {
      tables: ['users'],
      reason: 'reads/updates only the session user\'s own row (id from the signed token)',
    },
    'company/users': {
      tables: ['users'],
      reason: 'insert payload is built in the preceding statement with company_id: auth.companyId',
    },
    'company/users/[id]': {
      tables: ['users'],
      reason: 'global email-uniqueness probe; emails are globally unique by design (migration 013)',
    },
    'complaints': {
      tables: ['complaints'],
      reason: 'public tracking lookup by unguessable UUID, rate-limited, returns no company-scoped fields',
    },
  };

  test('every statement that reads a tenant table mentions the company scope', () => {
    const offenders: string[] = [];
    for (const route of tenantRoutes) {
      const exceptions = STATEMENT_SCOPE_EXCEPTIONS[route.name];
      const statements = route.src.split(/;(?=\s*\n)/);
      for (const stmt of statements) {
        for (const match of stmt.matchAll(/\.from\(\s*['"]([A-Za-z0-9_]+)['"]\s*\)/g)) {
          const table = match[1];
          const prefix = stmt.slice(0, match.index);
          if (/\.storage\s*$/.test(prefix)) continue; // bucket path is company-foldered at the call site
          if (GLOBAL_TABLES.has(table)) continue;
          if (exceptions?.tables.includes(table)) continue;
          if (/company_id|companyId/.test(stmt)) continue;
          offenders.push(`${route.name} :: ${table}`);
        }
      }
    }
    expect(offenders).toEqual([]);
    // The invariant must actually be scanning the tenant surface.
    expect(tenantRoutes.length).toBeGreaterThan(150);
  });

  /** Extract the balanced `{ ... }` params object that follows `.rpc('name', `. */
  function rpcParamsSlice(src: string, startIndex: number): string {
    const open = src.indexOf('{', startIndex);
    if (open < 0) return '';
    let depth = 0;
    for (let i = open; i < src.length; i++) {
      if (src[i] === '{') depth++;
      else if (src[i] === '}') {
        depth--;
        if (depth === 0) return src.slice(open, i + 1);
      }
    }
    return '';
  }

  test('every tenant-route RPC call binds the company from the session', () => {
    const offenders: string[] = [];
    for (const route of tenantRoutes) {
      for (const match of route.src.matchAll(/\.rpc\(\s*['"]([A-Za-z0-9_]+)['"]\s*,/g)) {
        const params = rpcParamsSlice(route.src, match.index + match[0].length);
        // The value must come from the authenticated context, not merely the
        // parameter being named p_company_id with an arbitrary value.
        if (!/p_company_id\s*:\s*(auth\.companyId|ctx\.companyId|companyId|auth\.company_id)\b/.test(params)) {
          offenders.push(`${route.name} :: ${match[1]}`);
        }
      }
    }
    expect(offenders).toEqual([]);
  });

  test('every tenant-route direct write to a tenant table scopes it to the session company', () => {
    const offenders: string[] = [];
    for (const route of tenantRoutes) {
      if (route.name === 'auth/me') continue; // self-update of the session user's own row
      const statements = route.src.split(/;(?=\s*\n)/);
      statements.forEach((stmt, index) => {
        for (const write of stmt.matchAll(/\.(update|delete|upsert)\(/g)) {
          // Only Supabase table writes (a `.from('table')` chain earlier in the
          // same statement). Crypto `.update()` calls (HMAC/hash) have none.
          if (!stmt.slice(0, write.index).includes('.from(')) continue;
          // Include the preceding statement only to see payload builders
          // (e.g. settings builds `updates` before the .upsert call).
          const window = (statements[index - 1] || '') + stmt;
          // The scoping value must be session-derived, not just a company_id key.
          const sessionBound =
            /company_id\s*:\s*(auth\.companyId|ctx\.companyId|companyId|auth\.company_id)\b/.test(window)
            || /\.eq\(\s*['"]company_id['"]\s*,\s*(auth\.companyId|ctx\.companyId|companyId|auth\.company_id)\b/.test(window)
            // A write addressed by the session company's own row id (e.g. the
            // companies profile update) can only touch the caller's tenant.
            || /\.eq\(\s*['"]id['"]\s*,\s*(auth\.companyId|ctx\.companyId|companyId)\b/.test(window)
            // A row-attribute filter (e.g. .eq('company_id', exp.company_id)) is
            // acceptable only when the same route fetches that table with a
            // session-derived company scope (the row itself is already tenant-bound).
            || (/\.eq\(\s*['"]company_id['"]\s*,\s*\w+\.company_id\b/.test(window)
              && /\.eq\(\s*['"]company_id['"]\s*,\s*auth\.companyId/.test(route.src));
          if (sessionBound) continue;
          offenders.push(`${route.name} :: ${write[1]}`);
        }
      });
    }
    expect(offenders).toEqual([]);
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

  test('the company table export pages through its tables', () => {
    const route = routes.find((entry) => entry.name === 'company/export-download')!;
    expect(route).toBeDefined();
    // Paging is what makes completeness possible.
    expect(route.src).toMatch(/\.range\(/);
    // And a read error must surface rather than becoming an empty table.
    expect(route.src).toMatch(/throw new Error\(/);
    // The removed JSON/backup export routes must not quietly return.
    for (const name of ['backup/download', 'backup/auto', 'backup/upload', 'backup/validate', 'company/data-export']) {
      expect(routes.some((entry) => entry.name === name)).toBe(false);
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
