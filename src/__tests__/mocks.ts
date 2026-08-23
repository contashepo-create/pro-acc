/**
 * Shared typed Supabase mock for Jest tests.
 *
 * Replaces the hand-rolled `any` builder objects that used to be copy-pasted
 * into every test file. The mock is structurally a `SupabaseLike`, so it can
 * be passed to any lib/API function without casts:
 *
 *   const db = mockSupabase({ rows: { accounts: [...] } });
 *   const rows = await loadReportAccounts(db, 'c1');
 *   expect(db.calls[0].filters).toContain('eq:company_id:c1');
 *
 * Resolution order per awaited query:
 *   1. `script` FIFO queue (each await shifts the next outcome) — for tests
 *      that drive a fixed sequence of responses;
 *   2. `results[table]` — per-table fixed outcome;
 *   3. the `rows[table]` store, filtered by the builder chain (eq/in/is/
 *      gte/gt/lte/lt/range/or);
 *   4. `defaultResult` or an empty selection.
 *
 * insert/update/delete act on the `rows` store so tests can observe
 * mutations. `calls` records every `from(table)` with the filters applied
 * through the chain (same `op:col:value` format the legacy in-test mocks
 * used, so existing filter assertions keep working).
 */

import type {
  QueryError,
  QueryResult,
  Row,
  SupabaseLike,
  SupabaseQuery,
  SupabaseTableBuilder,
  SupabaseStorage,
} from '@/lib/types';

export interface TestQueryResult {
  data: unknown;
  error: unknown;
  count?: number | null;
}

/**
 * Typed stand-in for the legacy `const api: any` self-referencing builders
 * used by hand-rolled `makeDb` test mocks. Method signatures are loose
 * (`unknown`) on purpose: each test file keeps its own filtering semantics,
 * this only removes the `any` annotations while staying structurally a
 * PromiseLike (via `then`) so awaited chains type-check.
 */
export interface TestBuilder {
  select?(columns?: string, options?: Row): TestBuilder;
  insert?(values: Row | Row[], options?: Row): TestBuilder;
  update?(values: Row, options?: Row): TestBuilder;
  upsert?(values: Row | Row[], options?: Row): TestBuilder;
  delete?(): TestBuilder;
  eq?(column: string, value: unknown): TestBuilder;
  neq?(column: string, value: unknown): TestBuilder;
  gt?(column: string, value: unknown): TestBuilder;
  gte?(column: string, value: unknown): TestBuilder;
  lt?(column: string, value: unknown): TestBuilder;
  lte?(column: string, value: unknown): TestBuilder;
  is?(column: string, value: unknown): TestBuilder;
  not?(column: string, filter: string, value?: unknown): TestBuilder;
  in?(column: string, values: readonly unknown[]): TestBuilder;
  contains?(column: string, value: unknown): TestBuilder;
  like?(column: string, value: string): TestBuilder;
  ilike?(column: string, value: string): TestBuilder;
  or?(expression: string, options?: Row): TestBuilder;
  order?(column?: string, options?: Row): TestBuilder;
  limit?(count: number, options?: Row): TestBuilder;
  range?(from: number, to: number): TestBuilder;
  maybeSingle?(): PromiseLike<TestQueryResult>;
  single?(): PromiseLike<TestQueryResult>;
  then<TResult1 = TestQueryResult, TResult2 = never>(
    onfulfilled?: ((value: TestQueryResult) => TResult1 | PromiseLike<TResult1>) | null,
    onrejected?: ((reason: unknown) => TResult2 | PromiseLike<TResult2>) | null,
  ): Promise<TResult1 | TResult2>;
}


export interface QueryOutcome {
  data?: unknown;
  /** Raw rejection value surfaced to the caller (QueryError, Error, or a
   *  bare PostgREST object) — the mock rejects exactly what is given. */
  error?: unknown;
  count?: number | null;
}

export interface MockCall {
  table: string;
  filters: string[];
}

export interface MockSupabaseOptions {
  /** Static per-table row store evaluated by the builder chain. */
  rows?: Record<string, Row[]>;
  /** Per-table fixed outcome (checked before the rows store). */
  results?: Record<string, QueryOutcome>;
  /** FIFO queue: each awaited query shifts the next outcome. */
  script?: QueryOutcome[];
  /** Fallback outcome when nothing else matches. */
  defaultResult?: QueryOutcome;
  /** Custom RPC behaviour (default: `{ data: null, error: null }`). */
  rpc?: (fn: string, args?: Row) => QueryResult<unknown> | Promise<QueryResult<unknown>>;
  /** Storage facade for functions that only use `client.storage`. */
  storage?: SupabaseStorage;
}

export interface MockSupabase extends SupabaseLike {
  calls: MockCall[];
  /** Override the outcome resolved for subsequent queries on `table`. */
  setResult(table: string, outcome: QueryOutcome): void;
}

const isNumericComparison = (value: unknown): boolean =>
  typeof value === 'number' || typeof value === 'string';

/** Evaluate one `col.op.value` segment of an `or(...)` expression. */
function matchSegment(row: Row, segment: string): boolean {
  if (segment.endsWith('.not.is.null')) {
    return row[segment.slice(0, -'.not.is.null'.length)] != null;
  }
  if (segment.endsWith('.is.null')) {
    return row[segment.slice(0, -'.is.null'.length)] == null;
  }
  const parts = segment.split('.');
  if (parts.length !== 3) return false;
  const [column, op, rawValue] = parts;
  const value = rawValue === 'null' ? null : rawValue;
  const cell = row[column];
  switch (op) {
    case 'eq': return cell === value;
    case 'neq': return cell !== value;
    case 'gt': return isNumericComparison(rawValue) ? Number(cell) > Number(rawValue) : false;
    case 'gte': return isNumericComparison(rawValue) ? Number(cell) >= Number(rawValue) : false;
    case 'lt': return isNumericComparison(rawValue) ? Number(cell) < Number(rawValue) : false;
    case 'lte': return isNumericComparison(rawValue) ? Number(cell) <= Number(rawValue) : false;
    default: return false;
  }
}

export function mockSupabase(options: MockSupabaseOptions = {}): MockSupabase {
  const perTable = new Map<string, QueryOutcome>(Object.entries(options.results ?? {}));
  const script = options.script ? [...options.script] : [];
  const calls: MockCall[] = [];

  function makeBuilder(table: string): SupabaseTableBuilder & SupabaseQuery {
    const filters: string[] = [];
    let working: Row[] | undefined = options.rows?.[table] ? [...options.rows[table]] : undefined;
    let rangeStart = 0;
    let rangeEnd = Number.MAX_SAFE_INTEGER;
    let action: 'select' | 'insert' | 'update' | 'upsert' | 'delete' = 'select';
    let actionValues: Row | Row[] | undefined;
    calls.push({ table, filters });

    const resolveRows = (): Row[] => {
      const rows = working ?? [];
      return rangeEnd < Number.MAX_SAFE_INTEGER ? rows.slice(rangeStart, rangeEnd + 1) : rows;
    };

    const buildQuery = (mode: 'array' | 'maybeSingle' | 'single'): Promise<QueryResult<Row[] | null>> => {
      // Mutations apply to the row store so follow-up reads observe them.
      if (working !== undefined && actionValues !== undefined) {
        if (action === 'insert' || action === 'upsert') {
          const inserted = Array.isArray(actionValues) ? actionValues : [actionValues];
          working = [...working, ...inserted];
        } else if (action === 'update') {
          const values = actionValues as Row;
          working = working.map((row) => ({ ...row, ...values }));
        } else if (action === 'delete') {
          working = [];
        }
      }
      const explicit = script.shift() ?? perTable.get(table);
      let data: unknown;
      let error: unknown = null;
      let count: number | null = null;
      if (explicit) {
        data = explicit.data !== undefined ? explicit.data : null;
        error = explicit.error ?? null;
        count = explicit.count ?? null;
      } else if (working !== undefined) {
        const rows = resolveRows();
        data = mode === 'array' ? rows : rows[0] ?? null;
      } else {
        data = options.defaultResult?.data !== undefined
          ? options.defaultResult.data
          : mode === 'array' ? [] : null;
        error = options.defaultResult?.error ?? null;
      }
      return Promise.resolve({
        data,
        error: error as QueryError | null,
        count,
      }) as Promise<QueryResult<Row[] | null>>;
    };

    const query = {
      select: (): SupabaseTableBuilder & SupabaseQuery => {
        action = 'select';
        return query;
      },
      insert: (values: Row | Row[]): SupabaseTableBuilder & SupabaseQuery => {
        action = 'insert';
        actionValues = values;
        return query;
      },
      update: (values: Row): SupabaseTableBuilder & SupabaseQuery => {
        action = 'update';
        actionValues = values;
        return query;
      },
      upsert: (values: Row | Row[]): SupabaseTableBuilder & SupabaseQuery => {
        action = 'upsert';
        actionValues = values;
        return query;
      },
      delete: (): SupabaseTableBuilder & SupabaseQuery => {
        action = 'delete';
        return query;
      },
      eq: (column: string, value: unknown) => {
        filters.push(`eq:${column}:${value}`);
        if (working) working = working.filter((row) => row[column] === value);
        return query;
      },
      neq: (column: string, value: unknown) => {
        if (working) working = working.filter((row) => row[column] !== value);
        return query;
      },
      gt: (column: string, value: unknown) => {
        if (working) working = working.filter((row) => Number(row[column]) > Number(value));
        return query;
      },
      gte: (column: string, value: unknown) => {
        if (working) working = working.filter((row) => Number(row[column]) >= Number(value));
        return query;
      },
      lt: (column: string, value: unknown) => {
        if (working) working = working.filter((row) => Number(row[column]) < Number(value));
        return query;
      },
      lte: (column: string, value: unknown) => {
        if (working) working = working.filter((row) => Number(row[column]) <= Number(value));
        return query;
      },
      is: (column: string, value: unknown) => {
        filters.push(`is:${column}:${value}`);
        if (working) working = working.filter((row) => row[column] === value);
        return query;
      },
      not: (column: string, filter: string, value?: unknown) => {
        if (working && filter === 'is') working = working.filter((row) => row[column] !== value);
        return query;
      },
      in: (column: string, values: readonly unknown[]) => {
        filters.push(`in:${column}:${values.join(',')}`);
        if (working) working = working.filter((row) => values.includes(row[column]));
        return query;
      },
      contains: (column: string, value: unknown) => {
        if (working) {
          working = working.filter((row) =>
            typeof row[column] === 'string' ? row[column].includes(String(value)) : false,
          );
        }
        return query;
      },
      like: (column: string, value: string) => {
        if (working) {
          const pattern = value.replace(/%/g, '.*').replace(/_/g, '.');
          working = working.filter(
            (row) => typeof row[column] === 'string' && new RegExp(`^${pattern}$`).test(row[column] as string),
          );
        }
        return query;
      },
      ilike: (column: string, value: string) => query.like(column, value),
      or: (expression: string) => {
        filters.push(`or:${expression}`);
        if (working) {
          const segments = expression.split(',').map((segment) => segment.trim());
          working = working.filter((row) => segments.some((segment) => matchSegment(row, segment)));
        }
        return query;
      },
      order: (): SupabaseTableBuilder & SupabaseQuery => query,
      limit: (count: number): SupabaseTableBuilder & SupabaseQuery => {
        rangeStart = 0;
        rangeEnd = count - 1;
        return query;
      },
      range: (from: number, to: number): SupabaseTableBuilder & SupabaseQuery => {
        rangeStart = from;
        rangeEnd = to;
        return query;
      },
      maybeSingle: () => buildQuery('maybeSingle') as Promise<QueryResult<Row | null>>,
      single: () => buildQuery('single') as Promise<QueryResult<Row | null>>,
      then<TResult1 = QueryResult<Row[] | null>, TResult2 = never>(
        onfulfilled?: ((value: QueryResult<Row[] | null>) => TResult1 | PromiseLike<TResult1>) | null,
        onrejected?: ((reason: unknown) => TResult2 | PromiseLike<TResult2>) | null,
      ): Promise<TResult1 | TResult2> {
        return buildQuery('array').then(onfulfilled ?? undefined, onrejected ?? undefined);
      },
    };
    return query;
  }

  const mock: MockSupabase = {
    from: (table: string) => makeBuilder(table),
    rpc: (fn: string, args?: Row) =>
      Promise.resolve(options.rpc ? options.rpc(fn, args) : { data: null, error: null, count: null }) as Promise<QueryResult<unknown>>,
    calls,
    setResult: (table: string, outcome: QueryOutcome) => {
      perTable.set(table, outcome);
    },
  };
  if (options.storage !== undefined) mock.storage = options.storage;
  return mock;
}

/**
 * Escape hatch for tests that need stateful/custom builder behaviour the
 * declarative options cannot express (per-call counters, conditional
 * rejections, ...). Wraps a hand-rolled `from` into a full `SupabaseLike`
 * (adds the no-op `rpc` the interface requires) so it stays assignable
 * without `any` casts at the call site.
 */
export function wrapSupabase(partial: {
  from: (table: string) => unknown;
  storage?: SupabaseStorage;
}): SupabaseLike {
  const mock: SupabaseLike = {
    from: partial.from as SupabaseLike['from'],
    rpc: async () => ({ data: null, error: null, count: null }),
  };
  if (partial.storage !== undefined) mock.storage = partial.storage;
  return mock;
}
