


/**
 * Shared boundary types for values whose exact shape is only known at
 * runtime: database rows (Postgres/PostgREST), parsed JSON payloads, and
 * loosely-typed third-party objects.
 *
 * Convention:
 *  - Use `Row` (not `any`) for DB rows and dynamic JSON. Property access
 *    yields `unknown`; convert at the use site with `String()` / `Number()`
 *    / a type guard instead of widening back to `any`.
 *  - Lib/API functions accept `SupabaseLike` (the minimal structural
 *    surface they actually use), so the real Supabase client AND the
 *    hand-rolled Jest mocks satisfy the same type without `any`.
 *  - `RequestLike` covers Next's Request cookies without importing the
 *    whole Next server type into core libs.
 *
 * This module is types-only: no runtime code, nothing to test.
 */

/** A DB row or dynamic JSON object: keys are runtime-known, values unknown. */
export type Row = Record<string, unknown>;

/** PostgREST error shape (NOT an Error instance). */
export interface QueryError {
  message: string;
  code?: string | null;
  details?: string | null;
  hint?: string | null;
}

export interface QueryResult<T = Row | Row[] | null> {
  data: T;
  error: QueryError | null;
  count?: number | null;
}

/**
 * The minimal PostgREST builder chain the codebase actually uses.
 * The real `SupabaseLike`'s builders and the Jest mock builders both
 * satisfy this interface structurally.
 */
/** The table builder returned by `from()`: actions first, then the chain. */
export interface SupabaseTableBuilder {
  select(columns?: string, options?: Row): SupabaseQuery;
  insert(values: Row | Row[], options?: Row): SupabaseQuery;
  update(values: Row): SupabaseQuery;
  upsert(values: Row | Row[], options?: Row): SupabaseQuery;
  delete(): SupabaseQuery;
}

export interface SupabaseQuery extends PromiseLike<QueryResult<Row[] | null>> {
  select(columns?: string, options?: Row): SupabaseQuery;
  eq(column: string, value: unknown): SupabaseQuery;
  neq(column: string, value: unknown): SupabaseQuery;
  gt(column: string, value: unknown): SupabaseQuery;
  gte(column: string, value: unknown): SupabaseQuery;
  lt(column: string, value: unknown): SupabaseQuery;
  lte(column: string, value: unknown): SupabaseQuery;
  is(column: string, value: unknown): SupabaseQuery;
  not(column: string, filter: string, value?: unknown): SupabaseQuery;
  in(column: string, values: readonly unknown[]): SupabaseQuery;
  contains(column: string, value: unknown): SupabaseQuery;
  like(column: string, value: string): SupabaseQuery;
  ilike(column: string, value: string): SupabaseQuery;
  or(filters: string, options?: Row): SupabaseQuery;
  order(column: string, options?: Row): SupabaseQuery;
  limit(count: number): SupabaseQuery;
  range(from: number, to: number): SupabaseQuery;
  maybeSingle(): PromiseLike<QueryResult<Row | null>>;
  single(): PromiseLike<QueryResult<Row | null>>;
}

export interface StorageObject {
  name: string;
  metadata?: { size?: number | null } | null;
}

export interface SupabaseBucket {
  list(path: string, options?: Row): PromiseLike<QueryResult<StorageObject[] | null>>;
  createSignedUrl(
    path: string,
    expiresInSeconds: number,
    options?: Row
  ): PromiseLike<QueryResult<{ signedUrl?: string; error?: string } | null>>;
  upload(path: string, file: unknown, options?: Row): PromiseLike<QueryResult<{ id?: string; path?: string; fullPath?: string } | null>>;
  remove(paths: string[]): PromiseLike<QueryResult<StorageObject[] | null>>;
}

export interface SupabaseStorage {
  from(bucket: string): SupabaseBucket;
}

/**
 * Minimal structural Supabase client: everything lib/API code touches.
 * The real client (SupabaseLike) is structurally assignable; Jest mocks
 * implement just what they need.
 */
export interface SupabaseLike {
  from(table: string): SupabaseTableBuilder;
  rpc(fn: string, args?: Row): PromiseLike<QueryResult<unknown>>;
  storage?: SupabaseStorage;
}

/** Minimal cookie-jar shape (NextRequest.cookies / test fakes). */
export interface CookieEntry {
  value?: string | null;
}

export interface CookieJarLike {
  get: (name: string) => CookieEntry | null | undefined;
}

/** A fetch/Next request that may carry (HttpOnly) cookies. */
export type RequestLike = Request & { cookies?: CookieJarLike | null };
