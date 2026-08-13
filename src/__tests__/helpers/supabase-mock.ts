/**
 * Shared in-memory Supabase client mock for route-level unit tests.
 *
 * It implements the fluent PostgREST-ish chain used by the auth routes:
 *   s.from(table).select(...).eq(...).maybeSingle()   -> awaited object
 *   s.from(table).select(...).eq(...).limit(1)        -> awaited array
 *   s.from(table).insert({...}) / .update({...}) / .upsert(...)
 *
 * Results are configured per table + terminal op as a QUEUE consumed in order:
 *   - setResult('users', 'select', rows)      → data is the rows array
 *   - setResult('users', 'single', objOrNull) → data is obj/null
 *   - setResults(t, op, [a, b, c])            → successive calls consume a,b,c
 */

interface RecordedCall {
  table: string;
  ops: { op: string; args: any[] }[];
}

type TerminalOp = 'single' | 'maybeSingle' | 'insert' | 'update' | 'upsert' | 'delete' | 'select';

const results = new Map<string, any[]>();
let calls: RecordedCall[] = [];

function terminalOp(ops: { op: string; args: any[] }[]): TerminalOp {
  const terminals = ['single', 'maybeSingle', 'insert', 'update', 'upsert', 'delete'];
  // Use the LAST terminal op in the chain: e.g. `.insert(...).select(...).single()`
  // ends with `.single()`, which is what is awaited and shapes the result.
  for (let i = ops.length - 1; i >= 0; i--) {
    if (terminals.includes(ops[i].op)) {
      return ops[i].op as TerminalOp;
    }
  }
  // A bare `.select(...)` awaited at the end returns array data.
  return 'select';
}

export const mockClient = {
  from(table: string) {
    const ops: { op: string; args: any[] }[] = [];
    const builder = new Proxy(
      {},
      {
        get(_target, prop) {
          if (prop === 'then') {
            return (resolve: (value: any) => void) => {
              resolve(mockClient.__resolve(table, ops));
            };
          }
          return (...args: any[]) => {
            ops.push({ op: prop as string, args });
            return builder;
          };
        },
      }
    );
    return builder;
  },

  __resolve(table: string, ops: { op: string; args: any[] }[]) {
    calls.push({ table, ops: [...ops] });
    const terminal = terminalOp(ops);
    const key = `${table}:${terminal}`;
    const queue = results.get(key);
    if (queue && queue.length > 0) {
      const val = queue.shift();
      return { data: val, error: null };
    }

    // Sensible test defaults when test doesn't explicitly set a result.
    // These mirror a healthy paid subscriber so the subscription-guard
    // doesn't trip up unrelated unit tests.
    if (table === 'subscriptions') {
      if (terminal === 'single' || terminal === 'maybeSingle') {
        return {
          data: {
            id: 'sub-test',
            company_id: 'co-test',
            plan_id: 'plan-start',
            plan_code: 'start',
            status: 'active',
            start_date: '2024-01-01',
            end_date: new Date(Date.now() + 30 * 86400000).toISOString().split('T')[0],
            extra_users: 0,
            extra_branches: 0,
            extra_storage_gb: 0,
            addons_json: {},
            subscription_plans: {
              code: 'start',
              name: 'Start',
              trial_days: 7,
              max_users: 1,
              max_storage_mb: 0,
              features_modules: { dashboard: true, accounts: true, journal: true, invoices: true, quotations: true, clients: true, contacts: true, reports_basic: true, settings: true, subscription: true, messages: true },
            },
          },
          error: null,
        };
      }
      return { data: [], error: null };
    }
    if (table === 'companies') {
      if (terminal === 'single' || terminal === 'maybeSingle') {
        return { data: { id: 'co-test', is_active: true, name: 'Test Co' }, error: null };
      }
      return { data: [], error: null };
    }
    if (table === 'users') {
      if (terminal === 'select') return { data: [], error: null };
    }
    return { data: null, error: null };
  },
};

export function resetMock() {
  calls = [];
  results.clear();
}

/** Configure a single response for a table + terminal op. */
export function setResult(table: string, op: TerminalOp, value: any) {
  results.set(`${table}:${op}`, [value]);
}

/** Configure a queue of responses consumed in order across successive calls. */
export function setResults(table: string, op: TerminalOp, queue: any[]) {
  results.set(`${table}:${op}`, [...queue]);
}

export function getCalls(): RecordedCall[] {
  return calls;
}

/** Find the first op on a table (e.g. the update/insert object in args[0]). */
export function findOp(table: string, op: string): { op: string; args: any[] } | null {
  for (const call of calls) {
    for (const o of call.ops) {
      if (o.op === op && call.table === table) return o;
    }
  }
  return null;
}

/** All calls for a table. */
export function callsForTable(table: string): RecordedCall[] {
  return calls.filter((c) => c.table === table);
}
