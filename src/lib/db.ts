import {Pool, PoolClient, QueryResult, QueryResultRow} from 'pg';
import {lookup} from 'dns';


// Custom lookup that tries both IPv4 and IPv6
function dnsLookup(
  hostname: string,
  _options: Record<string, unknown>,
  callback: (err: Error | null, address?: string, family?: number) => void
): void {
  lookup(hostname, { all: true, family: 0 }, (err, addresses) => {
    if (err) return callback(err);
    if (!addresses || addresses.length === 0) {
      return callback(new Error(`No addresses found for ${hostname}`));
    }
    // Node's lookup contract accepts one selected address; DNS already
    // returned at least one candidate above.
    callback(null, addresses[0].address, addresses[0].family);
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
  let sslConfig = undefined;
  if (connectionString.includes('supabase')) {
    if (process.env.DATABASE_CA_CERT) {
      sslConfig = {
        rejectUnauthorized: true,
        ca: process.env.DATABASE_CA_CERT,
      };
    } else {
      // SECURITY: In production, TLS verification MUST be enforced. Refuse to start
      // without DATABASE_CA_CERT to avoid MITM-vulnerable connections.
      if (process.env.NODE_ENV === 'production') {
        throw new Error(
          'DATABASE_CA_CERT must be set in production to enforce TLS certificate ' +
          'verification for the database connection (rejectUnauthorized). ' +
          'Set DATABASE_CA_CERT with the Supabase CA certificate. ' +
          'See: https://supabase.com/docs/guides/database/connecting-to-postgres#verifying-the-ssl-certificate'
        );
      }
      // Development: allow unverified connections with a clear warning.
      sslConfig = { rejectUnauthorized: false };
      console.warn(
        '⚠️ SECURITY WARNING: DATABASE_CA_CERT is not set; TLS verification DISABLED ' +
        '(rejectUnauthorized: false). This is acceptable only for local development.'
      );
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

export async function query<T extends QueryResultRow = Record<string, unknown>>(text: string, params?: unknown[]): Promise<QueryResult<T>> {
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
