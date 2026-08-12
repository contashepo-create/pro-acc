import { describe, it, expect } from 'vitest';

const round2 = (n: number) => Math.round((n + Number.EPSILON) * 100) / 100;

function computeFile(txs: Array<{ type: string; amount: number }>, headerAmount = 0) {
  const deposits = txs.filter((x) => x.type === 'addition' || x.type === 'deposit' || x.type === 'open');
  const expenses = txs.filter((x) => x.type === 'expense');
  const totalReceived = round2(deposits.reduce((s, x) => s + x.amount, 0) || headerAmount);
  const totalExpenses = round2(expenses.reduce((s, x) => s + x.amount, 0));
  const remaining = round2(Math.max(0, totalReceived - totalExpenses));
  const closed = false;
  const status = closed ? 'settled' : totalExpenses > 0 ? 'partially_settled' : 'open';
  return { totalReceived, totalExpenses, remaining, status };
}

describe('custody file balances', () => {
  it('opening only equals remaining', () => {
    const f = computeFile([{ type: 'addition', amount: 5000 }], 5000);
    expect(f.totalReceived).toBe(5000);
    expect(f.remaining).toBe(5000);
    expect(f.status).toBe('open');
  });

  it('expense deducts without changing received', () => {
    const f = computeFile([
      { type: 'addition', amount: 5000 },
      { type: 'expense', amount: 1200 },
    ]);
    expect(f.totalReceived).toBe(5000);
    expect(f.totalExpenses).toBe(1200);
    expect(f.remaining).toBe(3800);
    expect(f.status).toBe('partially_settled');
  });

  it('top-up then invoice', () => {
    const f = computeFile([
      { type: 'addition', amount: 1000 },
      { type: 'addition', amount: 4000 },
      { type: 'expense', amount: 2500 },
    ]);
    expect(f.totalReceived).toBe(5000);
    expect(f.remaining).toBe(2500);
  });

  it('full spend remaining is zero but not auto-closed', () => {
    const f = computeFile([
      { type: 'addition', amount: 800 },
      { type: 'expense', amount: 800 },
    ]);
    expect(f.remaining).toBe(0);
    expect(f.status).toBe('partially_settled');
  });

  it('return and shortage do not inflate received', () => {
    const f = computeFile([
      { type: 'addition', amount: 1000 },
      { type: 'expense', amount: 400 },
      { type: 'return', amount: 200 },
      { type: 'shortage', amount: 400 },
    ]);
    expect(f.totalReceived).toBe(1000);
    expect(f.totalExpenses).toBe(400);
    expect(f.remaining).toBe(600);
  });
});
