import { Pool, PoolClient, QueryResult, QueryResultRow } from 'pg';
import { setDefaultResultOrder } from 'dns';
setDefaultResultOrder('ipv4first');

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  max: 20,
  idleTimeoutMillis: 30000,
  connectionTimeoutMillis: 10000,
  ssl: process.env.DATABASE_URL?.includes('supabase')
    ? { rejectUnauthorized: true }
    : undefined,
});

pool.on('error', (err) => {
  console.error('Unexpected pool error:', err);
});

export async function query<T extends QueryResultRow = any>(text: string, params?: any[]): Promise<QueryResult<T>> {
  const start = Date.now();
  try {
    const res = await pool.query<T>(text, params);
    const duration = Date.now() - start;
    if (duration > 1000) {
      if (process.env.NODE_ENV === 'development') {
        console.warn('Slow query:', { text: text.substring(0, 100), duration, rows: res.rowCount });
      } else {
        console.warn('Slow query:', { duration, rows: res.rowCount });
      }
    }
    return res;
  } catch (err) {
    if (process.env.NODE_ENV === 'development') {
      console.error('Query error:', { text: text.substring(0, 100) });
    } else {
      console.error('Database query error');
    }
    throw err;
  }
}

export async function transaction<T>(fn: (client: PoolClient) => Promise<T>): Promise<T> {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const result = await fn(client);
    await client.query('COMMIT');
    return result;
  } catch (e) {
    await client.query('ROLLBACK');
    throw e;
  } finally {
    client.release();
  }
}

export async function getClient(): Promise<PoolClient> {
  return pool.connect();
}

export async function endPool(): Promise<void> {
  await pool.end();
}
