import { getBackupSecret } from '@/lib/backup-integrity';
import { backupFilename } from '@/lib/backup-retention';
import { computeWip, computeRetainage } from '@/lib/construction';
import { getTemplateConfig } from '@/lib/invoice-templates';
import { formatCurrency, formatDate, formatDateTime } from '@/lib/utils';

describe('small remaining branch paths', () => {
  test('backup secret uses dedicated, development fallback, and fails closed', () => {
    const env = { backup: process.env.BACKUP_SECRET, token: process.env.TOKEN_SECRET, node: process.env.NODE_ENV };
    process.env.BACKUP_SECRET = 'test-only-dedicated-backup-secret-32-chars';
    expect(getBackupSecret()).toContain('dedicated');
    delete process.env.BACKUP_SECRET; process.env.TOKEN_SECRET = 'test-only-fallback-token-secret-32-chars'; Reflect.set(process.env, 'NODE_ENV', 'test');
    expect(getBackupSecret()).toContain('fallback');
    process.env.TOKEN_SECRET = 'short';
    expect(() => getBackupSecret()).toThrow('BACKUP_SECRET');
    delete process.env.TOKEN_SECRET;
    expect(() => getBackupSecret()).toThrow('BACKUP_SECRET');
    Reflect.set(process.env, 'NODE_ENV', 'production');
    process.env.TOKEN_SECRET = 'test-only-long-token-secret-production-32-chars';
    expect(() => getBackupSecret()).toThrow('BACKUP_SECRET');
    if (env.backup === undefined) delete process.env.BACKUP_SECRET; else process.env.BACKUP_SECRET = env.backup;
    if (env.token === undefined) delete process.env.TOKEN_SECRET; else process.env.TOKEN_SECRET = env.token;
    Reflect.set(process.env, 'NODE_ENV', env.node);
  });

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
