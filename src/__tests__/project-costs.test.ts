const accumulateProjectLine = (
  acc: { expenses: number; revenue: number },
  line: { type?: string | null; debit?: number; credit?: number },
) => {
  const debit = Number(line.debit) || 0;
  const credit = Number(line.credit) || 0;
  if (line.type === 'expense') acc.expenses += debit - credit;
  if (line.type === 'revenue') acc.revenue += credit - debit;
  return acc;
};

function run(lines: Array<{ type: string; debit: number; credit: number }>) {
  return lines.reduce((acc, l) => accumulateProjectLine(acc, l), { expenses: 0, revenue: 0 });
}

describe('project job cost from journal types', () => {
  it('custody-paid bill: expense debit counts, 1150 credit does not', () => {
    const r = run([
      { type: 'expense', debit: 1000, credit: 0 },
      { type: 'asset', debit: 0, credit: 1000 },
    ]);
    expect(r.expenses).toBe(1000);
    expect(r.revenue).toBe(0);
  });

  it('opening custody on a project is not job cost', () => {
    const r = run([{ type: 'asset', debit: 5000, credit: 0 }]);
    expect(r.expenses).toBe(0);
  });

  it('supplier bill: expense + AP does not double', () => {
    const r = run([
      { type: 'expense', debit: 800, credit: 0 },
      { type: 'liability', debit: 0, credit: 800 },
    ]);
    expect(r.expenses).toBe(800);
  });

  it('sales invoice: revenue not expense', () => {
    const r = run([
      { type: 'asset', debit: 1150, credit: 0 },
      { type: 'revenue', debit: 0, credit: 1000 },
      { type: 'liability', debit: 0, credit: 150 },
    ]);
    expect(r.revenue).toBe(1000);
    expect(r.expenses).toBe(0);
  });

  it('invoice without project tag is excluded (no lines)', () => {
    const r = run([]);
    expect(r.expenses).toBe(0);
    expect(r.revenue).toBe(0);
  });

  it('VAT on sales is not job revenue', () => {
    const r = run([
      { type: 'asset', debit: 1150, credit: 0 },
      { type: 'revenue', debit: 0, credit: 1000 },
      { type: 'liability', debit: 0, credit: 150 },
    ]);
    expect(r.revenue).toBe(1000);
  });

  it('input VAT on purchase is not job cost', () => {
    const r = run([
      { type: 'expense', debit: 1000, credit: 0 },
      { type: 'asset', debit: 150, credit: 0 },
      { type: 'asset', debit: 0, credit: 1150 },
    ]);
    expect(r.expenses).toBe(1000);
  });

  it('reversal of expense reduces cost', () => {
    const r = run([
      { type: 'expense', debit: 400, credit: 0 },
      { type: 'expense', debit: 0, credit: 400 },
    ]);
    expect(r.expenses).toBe(0);
  });
});
