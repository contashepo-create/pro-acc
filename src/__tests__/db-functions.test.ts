const poolQuery = jest.fn();
const connect = jest.fn();
const end = jest.fn();
const on = jest.fn();
const Pool = jest.fn(() => ({ query: poolQuery, connect, end, on }));

jest.mock('pg', () => ({ Pool }));
jest.mock('dns', () => ({ lookup: jest.fn() }));

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
