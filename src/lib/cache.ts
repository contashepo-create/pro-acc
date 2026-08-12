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
 */
export const ROUTE_CACHE_CONFIG: Record<string, CacheOptions> = {
  // Tenant data is company-scoped and mutates on every create/delete.
  // Caching lists caused "deleted but still visible" then Not found on retry.
  'GET:/api/accounts': { cache: 'no-store' },
  'GET:/api/journal': { cache: 'no-store' },
  'GET:/api/banks': { cache: 'no-store' },
  'GET:/api/dashboard': { cache: 'no-store' },
  'GET:/api/categories': { cache: 'no-store' },
  'GET:/api/settings': { cache: 'no-store' },
  'GET:/api/reports': { cache: 'no-store' },
  'GET:/api/currencies': { cache: 'no-store' },
  'GET:/api/financial': { cache: 'no-store' },
  'GET:/api/admin/subscription-plans': { cache: 'public', maxAge: 3600, staleWhileRevalidate: 600 },
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
 */
export function applyCacheHeaders(response: NextResponse, options: CacheOptions): NextResponse {
  const { cache = 'private', maxAge = 0, staleWhileRevalidate = 0, vary } = options;
  
  if (cache === 'no-store') {
    response.headers.set('Cache-Control', 'no-store, no-cache, must-revalidate');
  } else {
    const directives = [
      cache,
      `max-age=${maxAge}`,
      staleWhileRevalidate > 0 ? `stale-while-revalidate=${staleWhileRevalidate}` : '',
    ].filter(Boolean).join(', ');
    
    response.headers.set('Cache-Control', directives);
  }
  
  if (vary) {
    response.headers.set('Vary', vary);
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
