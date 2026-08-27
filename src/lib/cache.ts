import { NextResponse } from 'next/server';

/**
 * Cache configuration for API routes
 * 
 * Usage in GET handlers:
 *   const data = await fetchData();
 *   return success(data, 200, { cache: 'public', maxAge: 60 });
 */

export interface CacheOptions {
  /** Cache type: 'public' (shared CDN), 'private' (browser only), 'no-store' (never cache) */
  cache?: 'public' | 'private' | 'no-store';
  /** Max age in seconds for CDN cache */
  maxAge?: number;
  /** Max age in seconds for stale-while-revalidate */
  staleWhileRevalidate?: number;
  /** Vary header (e.g., 'Authorization, Cookie') */
  vary?: string;
  /** ETag for conditional requests */
  etag?: string;
}

const DEFAULT_CACHE: CacheOptions = {
  cache: 'private',
  maxAge: 0,
  staleWhileRevalidate: 0,
};

/**
 * Route-specific cache configuration
 * Maps route patterns to cache settings
 *
 * SECURITY RULES (do not relax):
 *   1. Any endpoint that returns company-scoped data MUST be 'private' or 'no-store'.
 *      'public' caches response across ALL visitors (CDN level) → cross-tenant data leak.
 *   2. Admin endpoints are only served to superadmin and are never CDN-cacheable.
 *   3. Auth/session/cookie-varying endpoints MUST add Vary: Cookie and use 'private'
 *      so browsers don't share them across tabs/users.
 *   4. Use 'public' ONLY for truly anonymous, stateless assets (e.g. advertisement feed,
 *      public plan listings) and those MUST NOT depend on Cookie/Authorization.
 */
export const ROUTE_CACHE_CONFIG: Record<string, CacheOptions> = {
  // Tenant data is company-scoped and mutates on every create/delete.
  'GET:/api/accounts': { cache: 'no-store' },
  'GET:/api/journal': { cache: 'no-store' },
  'GET:/api/banks': { cache: 'no-store' },
  'GET:/api/dashboard': { cache: 'no-store' },
  'GET:/api/categories': { cache: 'no-store' },
  'GET:/api/settings': { cache: 'no-store' },
  'GET:/api/reports': { cache: 'no-store' },
  'GET:/api/financial-audit': { cache: 'no-store' },
  'GET:/api/currencies': { cache: 'no-store' },
  'GET:/api/financial': { cache: 'no-store' },
  'GET:/api/invoices': { cache: 'no-store' },
  'GET:/api/quotations': { cache: 'no-store' },
  'GET:/api/contacts': { cache: 'no-store' },
  'GET:/api/clients': { cache: 'no-store' },
  'GET:/api/suppliers': { cache: 'no-store' },
  'GET:/api/inventory': { cache: 'no-store' },
  'GET:/api/projects': { cache: 'no-store' },
  'GET:/api/employees': { cache: 'no-store' },
  'GET:/api/warehouses': { cache: 'no-store' },
  'GET:/api/branches': { cache: 'no-store' },
  'GET:/api/custodies': { cache: 'no-store' },
  'GET:/api/fixed-assets': { cache: 'no-store' },
  'GET:/api/purchases': { cache: 'no-store' },
  'GET:/api/vouchers': { cache: 'no-store' },
  'GET:/api/budgets': { cache: 'no-store' },
  'GET:/api/cost-centers': { cache: 'no-store' },
  'GET:/api/tax-returns': { cache: 'no-store' },
  'GET:/api/messages': { cache: 'no-store' },
  'GET:/api/notifications': { cache: 'no-store' },
  'GET:/api/payroll': { cache: 'no-store' },
  'GET:/api/pos': { cache: 'no-store' },
  'GET:/api/company': { cache: 'no-store' },
  // Authenticated self
  'GET:/api/auth/me': { cache: 'no-store', vary: 'Cookie' },
  'GET:/api/auth/subscription': { cache: 'no-store', vary: 'Cookie' },
  'GET:/api/auth/subscription-status': { cache: 'no-store', vary: 'Cookie' },
  // Admin endpoints — never publicly cacheable.
  'GET:/api/admin': { cache: 'no-store', vary: 'Cookie' },
  'GET:/api/admin/session': { cache: 'no-store', vary: 'Cookie' },
  'GET:/api/admin/subscription-plans': { cache: 'private', maxAge: 60, vary: 'Cookie' },
  // Public plan listings used on landing page (no auth needed)
  'GET:/api/advertisements': { cache: 'public', maxAge: 60, staleWhileRevalidate: 300 },
};

/**
 * Get cache config for a route
 */
export function getCacheConfig(method: string, pathname: string): CacheOptions {
  const key = `${method}:${pathname}`;
  
  // Exact match
  if (ROUTE_CACHE_CONFIG[key]) return ROUTE_CACHE_CONFIG[key];
  
  // Pattern match (e.g., /api/reports/aging matches /api/reports)
  for (const [pattern, config] of Object.entries(ROUTE_CACHE_CONFIG)) {
    if (pathname.startsWith(pattern.split(':')[1])) {
      return config;
    }
  }
  
  return DEFAULT_CACHE;
}

/**
 * Apply cache headers to a NextResponse
 * SECURITY: even 'private' caches can leak across browser tabs if the user has
 * multiple accounts / is on a shared machine, so we default to Vary: Cookie and
 * add Pragma/Expires for legacy proxies on no-store responses.
 */
export function applyCacheHeaders(response: NextResponse, options: CacheOptions): NextResponse {
  const { cache = 'private', maxAge = 0, staleWhileRevalidate = 0, vary } = options;
  
  if (cache === 'no-store') {
    response.headers.set('Cache-Control', 'no-store, no-cache, must-revalidate, private');
    response.headers.set('Pragma', 'no-cache');
    response.headers.set('Expires', '0');
  } else {
    const directives = [
      cache,
      `max-age=${maxAge}`,
      staleWhileRevalidate > 0 ? `stale-while-revalidate=${staleWhileRevalidate}` : '',
    ].filter(Boolean).join(', ');
    
    response.headers.set('Cache-Control', directives);
  }

  // Any non-public response must vary on Cookie so caches don't serve cached
  // pages from one session to another. Public endpoints never read Cookie.
  if (cache !== 'public') {
    const existing = response.headers.get('Vary');
    const needed = (vary ? `${vary}, Cookie` : 'Cookie, Authorization');
    const merged = existing ? `${existing}, ${needed}` : needed;
    response.headers.set('Vary', merged);
  } else if (vary) {
    response.headers.set('Vary', vary);
  }
  
  // Security headers — apply at response level for defense-in-depth.
  if (!response.headers.has('X-Content-Type-Options')) {
    response.headers.set('X-Content-Type-Options', 'nosniff');
  }
  if (!response.headers.has('X-Frame-Options')) {
    response.headers.set('X-Frame-Options', 'DENY');
  }
  if (!response.headers.has('Referrer-Policy')) {
    response.headers.set('Referrer-Policy', 'strict-origin-when-cross-origin');
  }

  return response;
}

/**
 * Generate an ETag for response data
 */
export function generateETag(data: unknown): string {
  const str = JSON.stringify(data);
  let hash = 0;
  for (let i = 0; i < str.length; i++) {
    const char = str.charCodeAt(i);
    hash = ((hash << 5) - hash) + char;
    hash = hash & hash; // Convert to 32bit integer
  }
  return `"${Math.abs(hash).toString(36)}"`;
}

/**
 * Check if request has a matching ETag (304 Not Modified)
 */
export function checkETag(request: Request, etag: string): boolean {
  const ifNoneMatch = request.headers.get('If-None-Match');
  return ifNoneMatch === etag;
}
