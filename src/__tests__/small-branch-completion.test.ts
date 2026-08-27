import { backupFilename } from '@/lib/backup-retention';
import { computeWip, computeRetainage } from '@/lib/construction';
import { getTemplateConfig } from '@/lib/invoice-templates';
import { formatCurrency, formatDate, formatDateTime } from '@/lib/utils';

describe('small remaining branch paths', () => {
  test('uses backup filename default date and template default id', () => {
    expect(backupFilename()).toMatch(/^backup-\d{8}-\d{6}\.dump$/);
    expect(getTemplateConfig('missing')).toBe(getTemplateConfig('modern'));
  });

  test('construction exact tolerance stays on track', () => {
    expect(computeWip({ contractAmount: 100, costsIncurred: 50, billedToDate: 50.004 }).status).toBe('on-track');
    expect(computeWip({ contractAmount: 100, costsIncurred: 50, billedToDate: 50.006 }).status).toBe('over-billed');
    expect(computeRetainage({ billingAmount: 100, retainagePercent: 0.1, priorRetained: 0, retainageCap: 100 })).toMatchObject({ retainedThisCycle: 10, capped: false });
  });

  test('utility formatters accept default locale and invalid values', () => {
    expect(formatCurrency(1)).toBeTruthy();
    expect(formatDate(undefined)).toBe('');
    expect(formatDateTime(null)).toBe('');
  });
});
