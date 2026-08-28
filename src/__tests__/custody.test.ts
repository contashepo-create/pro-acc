

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
  test('opening only equals remaining', () => {
    const f = computeFile([{ type: 'addition', amount: 5000 }], 5000);
    expect(f.totalReceived).toBe(5000);
    expect(f.remaining).toBe(5000);
    expect(f.status).toBe('open');
  });

  test('expense deducts without changing received', () => {
    const f = computeFile([
      { type: 'addition', amount: 5000 },
      { type: 'expense', amount: 1200 },
    ]);
    expect(f.totalReceived).toBe(5000);
    expect(f.totalExpenses).toBe(1200);
    expect(f.remaining).toBe(3800);
    expect(f.status).toBe('partially_settled');
  });

  test('top-up then invoice', () => {
    const f = computeFile([
      { type: 'addition', amount: 1000 },
      { type: 'addition', amount: 4000 },
      { type: 'expense', amount: 2500 },
    ]);
    expect(f.totalReceived).toBe(5000);
    expect(f.remaining).toBe(2500);
  });

  test('full spend remaining is zero but not auto-closed', () => {
    const f = computeFile([
      { type: 'addition', amount: 800 },
      { type: 'expense', amount: 800 },
    ]);
    expect(f.remaining).toBe(0);
    expect(f.status).toBe('partially_settled');
  });

  test('two files for one employee stay independent', () => {
    const site = computeFile([{ type: 'addition', amount: 3000 }, { type: 'expense', amount: 800 }]);
    const office = computeFile([{ type: 'addition', amount: 1500 }]);
    expect(site.remaining).toBe(2200);
    expect(office.remaining).toBe(1500);
    expect(site.remaining + office.remaining).toBe(3700);
  });

  test('return and shortage do not inflate received', () => {
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
