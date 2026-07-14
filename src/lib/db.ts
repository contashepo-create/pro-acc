import { Pool, PoolClient, QueryResult, QueryResultRow } from 'pg';
import { lookup } from 'dns';

// Custom lookup that tries both IPv4 and IPv6
function dnsLookup(hostname: string, options: any, callback: any) {
  lookup(hostname, { all: true, family: 0 }, (err, addresses) => {
    if (err) return callback(err);
    if (!addresses || addresses.length === 0) {
      return callback(new Error(`No addresses found for ${hostname}`));
    }
    // Try each address until one works
    const tryAddress = (index: number) => {
      if (index >= addresses.length) {
        return callback(new Error(`All addresses failed for ${hostname}`));
      }
      callback(null, addresses[index].address, addresses[index].family);
    };
    tryAddress(0);
  });
}

let _pool: Pool | null = null;

function getPool(): Pool {
  if (_pool) return _pool;

  // Strip BOM character that PowerShell/vercel CLI may add
  const connectionString = (process.env.DATABASE_URL || '').replace(/^\uFEFF/, '').trim();
  
  // SECURITY: SSL configuration for database connection
  // For Supabase: prefer proper CA verification. Set DATABASE_CA_CERT env var with the CA certificate
  // content to enable full certificate verification. If not set, falls back to { rejectUnauthorized: false }
  // which is vulnerable to MITM attacks but needed for Supabase's default certificate chain.
  // See: https://supabase.com/docs/guides/database/connecting-to-postgres#verifying-the-ssl-certificate
  let sslConfig: any = undefined;
  if (connectionString.includes('supabase')) {
    if (process.env.DATABASE_CA_CERT) {
      sslConfig = {
        rejectUnauthorized: true,
        ca: process.env.DATABASE_CA_CERT,
      };
    } else {
      // WARNING: This disables certificate verification, making the connection
      // theoretically vulnerable to MITM attacks. Set DATABASE_CA_CERT for production.
      sslConfig = { rejectUnauthorized: false };
      
      // SECURITY: Log a prominent warning in production when CA cert is missing
      if (process.env.NODE_ENV === 'production') {
        console.warn(
          '⚠️ SECURITY WARNING: DATABASE_CA_CERT is not set in production. ' +
          'Database connection TLS verification is DISABLED (rejectUnauthorized: false). ' +
          'This makes the connection vulnerable to MITM attacks. ' +
          'Set DATABASE_CA_CERT environment variable with the Supabase CA certificate. ' +
          'See: https://supabase.com/docs/guides/database/connecting-to-postgres#verifying-the-ssl-certificate'
        );
      }
    }
  }

  _pool = new Pool({
    connectionString,
    max: 10,
    idleTimeoutMillis: 30000,
    connectionTimeoutMillis: 10000,
    ssl: sslConfig,
    // @ts-expect-error - pg PoolConfig doesn't include 'lookup' but it's accepted at runtime
    lookup: dnsLookup,
  });

  _pool.on('error', (err) => {
    console.error('Unexpected pool error:', err);
  });

  return _pool;
}

export async function query<T extends QueryResultRow = any>(text: string, params?: any[]): Promise<QueryResult<T>> {
  const start = Date.now();
  try {
    const res = await getPool().query<T>(text, params);
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
  const client = await getPool().connect();
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
  return getPool().connect();
}

export async function endPool(): Promise<void> {
  if (_pool) {
    await _pool.end();
    _pool = null;
  }
}
