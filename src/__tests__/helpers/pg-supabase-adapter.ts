/**
 * PGlite-backed SupabaseLike adapter — executes the PostgREST-style fluent
 * chain as REAL SQL against an in-process Postgres (PGlite) that has the
 * full migration schema. Used by live-repro tests that need the genuine
 * data layer (column types, FK embeds, RPC functions) instead of queued
 * mock rows.
 *
 * Supported chain (the subset used by dashboard routes):
 *   from(t).select(cols, {count}).eq().in().neq().is().order().range().limit()
 *          .maybeSingle() / .single() / awaited
 *   from(t).insert(rows)   from(t).update(x).eq()...   from(t).delete().eq()...
 *   rpc('fn', params)
 *
 * Embedded resources ("projects(name), fixed_assets(name)") are resolved via
 * real FK introspection, exactly like PostgREST embeds.
 */

/* eslint-disable @typescript-eslint/no-explicit-any */
import type { PGlite } from '@electric-sql/pglite';

type Filter =
  | { kind: 'eq'; col: string; val: unknown }
  | { kind: 'neq'; col: string; val: unknown }
  | { kind: 'in'; col: string; vals: unknown[] }
  | { kind: 'is'; col: string; val: unknown };

interface BuilderState {
  table: string;
  filters: Filter[];
  orders: { col: string; asc: boolean; nullsFirst: boolean }[];
  rangeBounds: [number, number] | null;
  limitCount: number | null;
  countMode: 'exact' | null;
  selectCols: string;
  insertRows: Record<string, unknown>[] | null;
  updatePayload: Record<string, unknown> | null;
  deleteFlag: boolean;
  singleMode: 'maybe' | 'exact' | null;
}

const ident = (name: string) => `"${name.replace(/"/g, '""')}"`;

/** Split "a,b(rel1(x)),c" on top-level commas only. */
function splitTopLevel(input: string): string[] {
  const parts: string[] = [];
  let depth = 0;
  let current = '';
  for (const ch of input) {
    if (ch === '(') depth++;
    if (ch === ')') depth--;
    if (ch === ',' && depth === 0) {
      parts.push(current.trim());
      current = '';
    } else current += ch;
  }
  if (current.trim()) parts.push(current.trim());
  return parts;
}

export function makePgSupabase(db: PGlite) {
  // column-name → PG data type cache per table (numeric coercion parity with
  // PostgREST, which serializes numerics as JSON numbers).
  const typeCache = new Map<string, Record<string, string>>();
  const fkCache = new Map<string, Array<{ column: string; refTable: string }>>();

  async function tableTypes(table: string): Promise<Record<string, string>> {
    const hit = typeCache.get(table);
    if (hit) return hit;
    const res = await db.query(
      `SELECT column_name, data_type FROM information_schema.columns
        WHERE table_schema='public' AND table_name=$1`, [table]);
    const map: Record<string, string> = {};
    for (const row of res.rows as any[]) map[row.column_name] = row.data_type;
    typeCache.set(table, map);
    return map;
  }

  async function outgoingFks(table: string) {
    const hit = fkCache.get(table);
    if (hit) return hit;
    const res = await db.query(
      `SELECT a.attname AS column, confrelid::regclass::text AS ref
         FROM pg_constraint c
         JOIN pg_attribute a ON a.attrelid=c.conrelid AND a.attnum=ANY(c.conkey)
        WHERE c.contype='f' AND c.conrelid=$1::regclass`, [table]);
    const list = (res.rows as any[]).map((r) => ({
      column: String(r.column),
      refTable: String(r.ref).replace(/^public\./, ''),
    }));
    fkCache.set(table, list);
    return list;
  }

  function coerceRow(row: Record<string, unknown>, types: Record<string, string>) {
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(row)) {
      const t = types[k] || '';
      if (typeof v === 'string' && (t === 'numeric' || t.startsWith('int') || t === 'double precision')) {
        out[k] = v === '' ? null : Number(v);
      } else out[k] = v;
    }
    return out;
  }

  async function resolveEmbeds(
    table: string,
    rows: Record<string, unknown>[],
    embeds: { alias: string; rel: string; cols: string[] }[],
  ): Promise<void> {
    if (!rows.length || !embeds.length) return;
    const fks = await outgoingFks(table);
    for (const embed of embeds) {
      const fk = fks.find((f) => f.refTable === embed.rel);
      if (!fk) continue;
      const ids = [...new Set(rows.map((r) => r[fk.column]).filter((v) => v != null))];
      const linked = new Map<string, Record<string, unknown>>();
      if (ids.length) {
        const res = await db.query(
          `SELECT * FROM ${ident(embed.rel)} WHERE id = ANY($1)`, [ids]);
        const types = await tableTypes(embed.rel);
        for (const raw of res.rows as any[]) {
          linked.set(String(raw.id), coerceRow(raw as Record<string, unknown>, types));
        }
      }
      for (const row of rows) {
        const target = row[fk.column] != null ? linked.get(String(row[fk.column])) ?? null : null;
        if (target && embed.cols.length) {
          const subset: Record<string, unknown> = {};
          for (const c of embed.cols) subset[c] = target[c];
          row[embed.alias] = subset;
        } else {
          row[embed.alias] = target;
        }
      }
    }
  }

  /** WHERE clause whose $N placeholders start at `startIdx` (1-based). */
  function buildWhere(state: BuilderState, startIdx = 1): { clause: string; params: unknown[] } {
    const params: unknown[] = [];
    const conds: string[] = [];
    for (const f of state.filters) {
      const col = ident(f.col);
      if (f.kind === 'eq' || f.kind === 'neq') {
        params.push(f.val);
        conds.push(`${col} ${f.kind === 'eq' ? '=' : '<>'} $${startIdx + params.length - 1}`);
      } else if (f.kind === 'in') {
        params.push(f.vals);
        conds.push(`${col} = ANY($${startIdx + params.length - 1})`);
      } else if (f.kind === 'is') {
        if (f.val === null) conds.push(`${col} IS NULL`);
        else if (f.val === true || f.val === false) conds.push(`${col} IS ${f.val}`);
        else conds.push(`${col} IS NOT NULL`);
      }
    }
    return { clause: conds.length ? ` WHERE ${conds.join(' AND ')}` : '', params };
  }

  function selectBuilder(table: string) {
    const state: BuilderState = {
      table, filters: [], orders: [], rangeBounds: null, limitCount: null,
      countMode: null, selectCols: '*', insertRows: null, updatePayload: null,
      deleteFlag: false, singleMode: null,
    };

    const run = async (): Promise<{ data: any; error: any; count: number | null }> => {
      try {
        // ---- INSERT ----
        if (state.insertRows) {
          const first = state.insertRows[0];
          const cols = Object.keys(first);
          const params: unknown[] = [];
          const values = state.insertRows.map((row) => {
            const tuple = cols.map((c) => {
              params.push(row[c]);
              return `$${params.length}`;
            });
            return `(${tuple.join(',')})`;
          });
          const res = await db.query(
            `INSERT INTO ${ident(table)} (${cols.map(ident).join(',')})
             VALUES ${values.join(',')} RETURNING *`, params);
          const types = await tableTypes(table);
          const rows = (res.rows as any[]).map((r) => coerceRow(r, types));
          return { data: state.singleMode === 'exact' ? rows[0] : rows, error: null, count: null };
        }

        // ---- UPDATE ----
        if (state.updatePayload) {
          const setParams: unknown[] = [];
          const sets = Object.entries(state.updatePayload).map(([k, v]) => {
            setParams.push(v);
            return `${ident(k)}=$${setParams.length}`;
          });
          const where = buildWhere(state, setParams.length + 1);
          const res = await db.query(
            `UPDATE ${ident(table)} SET ${sets.join(',')}${where.clause} RETURNING *`,
            [...setParams, ...where.params]);
          const types = await tableTypes(table);
          const rows = (res.rows as any[]).map((r) => coerceRow(r, types));
          return { data: rows, error: null, count: null };
        }

        // ---- DELETE ----
        if (state.deleteFlag) {
          const where = buildWhere(state);
          const res = await db.query(
            `DELETE FROM ${ident(table)}${where.clause} RETURNING *`, where.params);
          return { data: res.rows as any[], error: null, count: null };
        }

        // ---- SELECT ----
        const where = buildWhere(state);
        const order = state.orders.length
          ? ` ORDER BY ${state.orders.map((o) => `${ident(o.col)} ${o.asc ? 'ASC' : 'DESC'} NULLS ${o.nullsFirst ? 'FIRST' : 'LAST'}`).join(', ')}`
          : '';
        const limit = state.rangeBounds
          ? ` LIMIT ${state.rangeBounds[1] - state.rangeBounds[0] + 1} OFFSET ${state.rangeBounds[0]}`
          : state.limitCount != null ? ` LIMIT ${state.limitCount}` : '';
        const res = await db.query(
          `SELECT * FROM ${ident(table)}${where.clause}${order}${limit}`, where.params);
        const types = await tableTypes(table);
        const rows = (res.rows as any[]).map((r) => coerceRow(r, types));

        // project select columns + embeds
        const parts = splitTopLevel(state.selectCols);
        const baseCols: string[] = [];
        const embeds: { alias: string; rel: string; cols: string[] }[] = [];
        for (const part of parts) {
          const embedMatch = part.match(/^(?:([\w]+):)?([\w]+)\(([^)]*)\)$/);
          if (embedMatch) {
            const [, alias, rel, cols] = embedMatch;
            embeds.push({
              alias: alias || rel,
              rel,
              cols: cols ? splitTopLevel(cols) : [],
            });
          } else if (part && part !== '*') {
            baseCols.push(part.split(':')[0]);
          }
        }
        await resolveEmbeds(table, rows, embeds);
        const projected = baseCols.length || embeds.length
          ? rows.map((row) => {
              const out: Record<string, unknown> = {};
              for (const c of baseCols) out[c] = row[c];
              for (const e of embeds) out[e.alias] = row[e.alias];
              return out;
            })
          : rows;

        let count: number | null = null;
        if (state.countMode === 'exact') {
          const cRes = await db.query(
            `SELECT COUNT(*)::int AS n FROM ${ident(table)}${where.clause}`, where.params);
          count = Number((cRes.rows as any[])[0]?.n ?? 0);
        }

        if (state.singleMode) return { data: projected[0] ?? null, error: null, count };
        return { data: projected, error: null, count };
      } catch (e) {
        return { data: null, error: { message: e instanceof Error ? e.message : String(e) }, count: null };
      }
    };

    const api: any = {
      select(cols: string = '*', opts?: { count?: string }) {
        state.selectCols = cols;
        if (opts?.count) state.countMode = 'exact';
        return api;
      },
      eq(col: string, val: unknown) { state.filters.push({ kind: 'eq', col, val }); return api; },
      neq(col: string, val: unknown) { state.filters.push({ kind: 'neq', col, val }); return api; },
      in(col: string, vals: unknown[]) { state.filters.push({ kind: 'in', col, vals }); return api; },
      is(col: string, val: unknown) { state.filters.push({ kind: 'is', col, val }); return api; },
      order(col: string, opts?: { ascending?: boolean; nullsFirst?: boolean }) {
        state.orders.push({ col, asc: opts?.ascending !== false, nullsFirst: !!opts?.nullsFirst });
        return api;
      },
      range(from: number, to: number) { state.rangeBounds = [from, to]; return api; },
      limit(n: number) { state.limitCount = n; return api; },
      insert(payload: Record<string, unknown> | Record<string, unknown>[]) {
        state.insertRows = Array.isArray(payload) ? payload : [payload];
        return api;
      },
      update(payload: Record<string, unknown>) { state.updatePayload = payload; return api; },
      delete() { state.deleteFlag = true; return api; },
      maybeSingle: () => { state.singleMode = 'maybe'; return run(); },
      single: () => { state.singleMode = 'exact'; return run(); },
      then(onFulfilled: any, onRejected: any) { return run().then(onFulfilled, onRejected); },
    };
    return api;
  }

  return {
    from: (table: string) => selectBuilder(table),
    rpc: async (fn: string, params: Record<string, unknown> = {}) => {
      try {
        const names = Object.keys(params);
        const args = names.map((n, i) => `${ident(n)}:=$${i + 1}`).join(',');
        const res = await db.query(
          `SELECT * FROM public.${ident(fn)}(${args})`, names.map((n) => params[n]));
        const rows = res.rows as any[];
        if (rows.length === 1) {
          const key = Object.keys(rows[0])[0];
          return { data: rows[0][key], error: null };
        }
        return { data: rows, error: null };
      } catch (e) {
        return { data: null, error: { message: e instanceof Error ? e.message : String(e) } };
      }
    },
    __pglite: db,
  };
}

export type PgSupabase = ReturnType<typeof makePgSupabase>;
