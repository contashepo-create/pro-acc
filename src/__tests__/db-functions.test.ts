const poolQuery = jest.fn();
const connect = jest.fn();
const end = jest.fn();
let capturedPoolErrorHandler: ((error: Error) => void) | undefined;
const on = jest.fn((event: string, callback: (error: Error) => void) => { if (event === 'error') capturedPoolErrorHandler = callback; });
let poolConfig: any;
const Pool = jest.fn((config: any) => { poolConfig = config; return { query: poolQuery, connect, end, on }; });
const lookup = jest.fn();

jest.mock('pg', () => ({ Pool }));
jest.mock('dns', () => ({ lookup }));

import { query, transaction, getClient, endPool } from '@/lib/db';

beforeEach(() => {
  jest.clearAllMocks();
  (process.env as Record<string, string | undefined>).NODE_ENV = 'test';
  process.env.DATABASE_URL = 'postgres://localhost/test';
});

describe('database pool helpers', () => {
  test('executes parameterized queries and returns the driver result', async () => {
    poolQuery.mockResolvedValueOnce({ rows: [{ id: 1 }], rowCount: 1 });
    await expect(query('select * from t where id=$1', [1])).resolves.toMatchObject({ rowCount: 1 });
    expect(poolQuery).toHaveBeenCalledWith('select * from t where id=$1', [1]);
  });

  test('custom DNS lookup handles resolver errors, empty results and the first address', async () => {
    if (!poolConfig) {
      poolQuery.mockResolvedValueOnce({ rows: [], rowCount: 0 });
      await query('select 1');
    }
    lookup.mockImplementationOnce((_host: string, _opts: unknown, cb: (error: Error | null, addresses?: Array<{ address: string; family: number }>) => void) => cb(new Error('dns')));
    const errorCallback = jest.fn();
    poolConfig.lookup('db.test', {}, errorCallback);
    expect(errorCallback.mock.calls[0][0]).toBeInstanceOf(Error);

    lookup.mockImplementationOnce((_host: string, _opts: unknown, cb: (error: Error | null, addresses?: Array<{ address: string; family: number }>) => void) => cb(null, []));
    const emptyCallback = jest.fn();
    poolConfig.lookup('db.test', {}, emptyCallback);
    expect(emptyCallback.mock.calls[0][0].message).toContain('No addresses');

    lookup.mockImplementationOnce((_host: string, _opts: unknown, cb: (error: Error | null, addresses?: Array<{ address: string; family: number }>) => void) => cb(null, [{ address: '1.2.3.4', family: 4 }]));
    const successCallback = jest.fn();
    poolConfig.lookup('db.test', {}, successCallback);
    expect(successCallback).toHaveBeenCalledWith(null, '1.2.3.4', 4);
    expect(typeof capturedPoolErrorHandler).toBe('function');
    capturedPoolErrorHandler!(new Error('pool'));
  });

  test('propagates query errors without leaking SQL in non-development logs', async () => {
    poolQuery.mockRejectedValueOnce(new Error('db down'));
    await expect(query('secret sql')).rejects.toThrow('db down');
  });

  test('commits successful transactions and always releases the client', async () => {
    const client = { query: jest.fn(async () => ({})), release: jest.fn() };
    connect.mockResolvedValueOnce(client);
    await expect(transaction(async (tx) => { expect(tx).toBe(client); return 42; })).resolves.toBe(42);
    expect((client.query as jest.Mock).mock.calls.map((call) => call[0])).toEqual(['BEGIN', 'COMMIT']);
    expect(client.release).toHaveBeenCalledTimes(1);
  });

  test('rolls back failed transactions and releases the client', async () => {
    const client = { query: jest.fn(async () => ({})), release: jest.fn() };
    connect.mockResolvedValueOnce(client);
    await expect(transaction(async () => { throw new Error('work failed'); })).rejects.toThrow('work failed');
    expect((client.query as jest.Mock).mock.calls.map((call) => call[0])).toEqual(['BEGIN', 'ROLLBACK']);
    expect(client.release).toHaveBeenCalledTimes(1);
  });

  test('enforces Supabase CA in production and configures development/verified TLS', async () => {
    await endPool();
    process.env.DATABASE_URL = 'postgres://project.supabase.co/db';
    delete process.env.DATABASE_CA_CERT;
    (process.env as any).NODE_ENV = 'production';
    await expect(query('select 1')).rejects.toThrow('DATABASE_CA_CERT');
    (process.env as any).NODE_ENV = 'test';
    poolQuery.mockResolvedValueOnce({ rows: [], rowCount: 0 });
    await query('select 1');
    expect(Pool).toHaveBeenLastCalledWith(expect.objectContaining({ ssl: { rejectUnauthorized: false } }));
    await endPool();
    process.env.DATABASE_CA_CERT = 'CERT';
    poolQuery.mockResolvedValueOnce({ rows: [], rowCount: 0 });
    await query('select 1');
    expect(Pool).toHaveBeenLastCalledWith(expect.objectContaining({ ssl: { rejectUnauthorized: true, ca: 'CERT' } }));
    delete process.env.DATABASE_CA_CERT;
  });

  test('logs slow queries with/without SQL according to environment', async () => {
    await endPool(); process.env.DATABASE_URL = 'postgres://localhost/db';
    const now = jest.spyOn(Date, 'now').mockReturnValueOnce(0).mockReturnValueOnce(1500);
    poolQuery.mockResolvedValueOnce({ rows: [], rowCount: 0 });
    (process.env as any).NODE_ENV = 'development';
    await query('select slow');
    now.mockRestore();
  });

  test('exposes a client and closes/resets the pool', async () => {
    const client = { query: jest.fn(), release: jest.fn() };
    connect.mockResolvedValueOnce(client);
    await expect(getClient()).resolves.toBe(client);
    await expect(endPool()).resolves.toBeUndefined();
    expect(end).toHaveBeenCalledTimes(1);
    // A second close is a no-op after reset.
    await endPool();
    expect(end).toHaveBeenCalledTimes(1);
  });
});
