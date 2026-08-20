/**
 * The pure validation layer shared by the dry-run endpoint and the real
 * restore: the same checks that block a malicious or foreign backup file.
 */
import { randomBytes } from 'crypto';
import { createHmac } from 'crypto';
import {
  parseBackupUploadBody, checkBackupSignature, checkBackupOwnership,
  validateBackupPayload, BackupValidationError, ALLOWED_BACKUP_TABLES,
  RESTORE_TABLES,
} from '@/lib/backup-validation';

process.env.BACKUP_SECRET = randomBytes(32).toString('hex');

const C1 = '11111111-2222-4333-8444-555555555555';
const C2 = '66666666-7777-4888-8999-aaaaaaaaaaaa';
const ROW_ID = '99999999-8888-4777-8666-555555555555';

function validBackup() {
  return {
    metadata: { company_id: C1, email: 'co@example.com', phone: '0500', version: '1.0' },
    data: {
      accounts: [{ id: ROW_ID, company_id: C1, code: '1110', name: 'نقدية' }],
      employees: [],
    },
  };
}

function signed(bundle: { backupData: unknown; fileHash: string }) {
  return bundle;
}

function makeSigned(backupData: unknown) {
  const json = JSON.stringify(backupData, null, 2);
  const hmac = createHmac('sha256', process.env.BACKUP_SECRET!).update(json).digest('hex');
  return signed({ backupData, fileHash: hmac.substring(0, 16) });
}

function bodyRequest(body: string) {
  return {
    url: 'http://localhost/api/backup/upload',
    method: 'POST',
    headers: { get: () => null },
    text: async () => body,
  } as unknown as Request;
}

describe('parseBackupUploadBody', () => {
  test('parses a valid body', async () => {
    const payload = makeSigned(validBackup());
    const parsed = await parseBackupUploadBody(bodyRequest(JSON.stringify(payload)));
    expect((parsed.backupData.metadata as any).company_id).toBe(C1);
    expect(parsed.fileHash.length).toBe(16);
  });

  test('rejects a body above the byte cap BEFORE parsing it', async () => {
    const big = JSON.stringify({ backupData: { data: { accounts: [{ x: 'a'.repeat(500) }] } }, fileHash: 'x' });
    await expect(parseBackupUploadBody(bodyRequest(big), 100)).rejects.toThrow(BackupValidationError);
    await expect(parseBackupUploadBody(bodyRequest(big), 100)).rejects.toMatchObject({ status: 413 });
  });

  test('rejects non-JSON text', async () => {
    await expect(parseBackupUploadBody(bodyRequest('not json{{'), 10_000)).rejects.toMatchObject({ status: 400 });
  });

  test('rejects nonobject envelopes, malformed backupData and missing/invalid fileHash', async () => {
    for (const payload of [null, [], 'x']) await expect(parseBackupUploadBody(bodyRequest(JSON.stringify(payload)))).rejects.toMatchObject({ status: 400 });
    for (const backupData of [null, [], 'x']) await expect(parseBackupUploadBody(bodyRequest(JSON.stringify({ backupData, fileHash: 'x' })))).rejects.toMatchObject({ status: 400 });
    for (const fileHash of [undefined, '', 1]) await expect(parseBackupUploadBody(bodyRequest(JSON.stringify({ backupData: validBackup(), fileHash })))).rejects.toMatchObject({ status: 400 });
  });
});

describe('checkBackupSignature', () => {
  test('accepts the exact signature produced for the content', () => {
    const payload = makeSigned(validBackup());
    expect(checkBackupSignature(payload.backupData as any, payload.fileHash).ok).toBe(true);
  });

  test('rejects a single-character modification', () => {
    const payload = makeSigned(validBackup());
    const tampered = JSON.parse(JSON.stringify(payload.backupData));
    tampered.data.accounts[0].name = 'معدل';
    expect(checkBackupSignature(tampered, payload.fileHash).ok).toBe(false);
  });
});

describe('checkBackupOwnership', () => {
  test('accepts the same company id', () => {
    expect(checkBackupOwnership(validBackup(), C1, 'co@example.com').ok).toBe(true);
  });

  test('rejects another or missing company id', () => {
    expect(checkBackupOwnership(validBackup(), C2, 'co@example.com').ok).toBe(false);
    expect(checkBackupOwnership({ data: {} } as any, C1).ok).toBe(false);
  });

  test('rejects mismatched email but permits absent optional emails', () => {
    const backup = validBackup();
    backup.metadata.email = 'old@example.com';
    expect(checkBackupOwnership(backup, C1, 'new@example.com').ok).toBe(false);
    expect(checkBackupOwnership(backup, C1, null).ok).toBe(true);
    expect(checkBackupOwnership(backup, C1, '').ok).toBe(true);
    delete (backup.metadata as any).email;
    expect(checkBackupOwnership(backup, C1, 'new@example.com').ok).toBe(true);
  });
});

describe('validateBackupPayload', () => {
  test('accepts a clean payload and reports its summary', () => {
    const report = validateBackupPayload(validBackup(), C1);
    expect(report.valid).toBe(true);
    expect(report.summary.tables.accounts.rows).toBe(1);
    expect(report.summary.totalRows).toBe(1);
  });

  test('rejects an unknown table', () => {
    const backup = validBackup() as any;
    backup.data.users = [{ id: ROW_ID, company_id: C1 }];
    const report = validateBackupPayload(backup, C1);
    expect(report.valid).toBe(false);
    expect(report.issues.some((issue) => issue.code === 'UNKNOWN_TABLE')).toBe(true);
  });

  test('rejects a row carrying another company id', () => {
    const backup = validBackup() as any;
    backup.data.accounts = [{ id: ROW_ID, company_id: C2 }];
    const report = validateBackupPayload(backup, C1);
    expect(report.valid).toBe(false);
    expect(report.issues.some((issue) => issue.code === 'CROSS_COMPANY')).toBe(true);
  });

  test('rejects malformed row ids (injection-shaped input)', () => {
    const backup = validBackup() as any;
    backup.data.accounts = [{ id: "x' OR '1'='1", company_id: C1 }];
    const report = validateBackupPayload(backup, C1);
    expect(report.valid).toBe(false);
    expect(report.issues.some((issue) => issue.code === 'BAD_ID')).toBe(true);
  });

  test('rejects rows that are not objects', () => {
    const backup = validBackup() as any;
    backup.data.accounts = ['not-an-object'];
    const report = validateBackupPayload(backup, C1);
    expect(report.valid).toBe(false);
  });

  test('handles missing data, nonarray tables, and enforces per-table/total caps', () => {
    expect(validateBackupPayload({ metadata: { company_id: C1 } } as any, C1).valid).toBe(true);
    const nonarray = validBackup() as any; nonarray.data.accounts = {};
    expect(validateBackupPayload(nonarray, C1).issues.some((issue) => issue.code === 'NOT_ARRAY')).toBe(true);
    const backup = validBackup() as any;
    backup.data.accounts = Array.from({ length: 3 }, (_, i) => ({
      id: `00000000-0000-4000-8000-${String(i + 1).padStart(12, '0')}`, company_id: C1,
    }));
    backup.data.invoices = [
      { id: '00000000-0000-4000-8000-000000000010', company_id: C1 },
      { id: '00000000-0000-4000-8000-000000000011', company_id: C1 },
    ];
    backup.data.contacts = [
      { id: '00000000-0000-4000-8000-000000000012', company_id: C1 },
      { id: '00000000-0000-4000-8000-000000000013', company_id: C1 },
    ];
    const limits = { maxBodyBytes: 25 * 1024 * 1024, maxRowsPerTable: 2, maxTotalRows: 2 };
    const report = validateBackupPayload(backup, C1, limits);
    expect(report.valid).toBe(false);
    expect(report.issues.some((issue) => issue.code === 'TOO_MANY_ROWS')).toBe(true);
    expect(report.issues.some((issue) => issue.code === 'TOO_MANY_TOTAL_ROWS')).toBe(true);
    expect(new BackupValidationError('x').status).toBe(400);
  });

  test('the allow-list and restore set stay aligned with the database RPC', () => {
    // The RPC (migration 050) restores exactly these six tables and accepts
    // exactly these thirteen. Keep the app-side constants in lockstep.
    expect([...RESTORE_TABLES].sort()).toEqual(
      ['accounts', 'banks_safes', 'contacts', 'employees', 'inventory_items', 'projects'],
    );
    expect([...ALLOWED_BACKUP_TABLES].sort()).toEqual([
      'accounts', 'banks_safes', 'cash_transactions', 'clients', 'contacts',
      'employees', 'inventory_items', 'invoice_items', 'invoices',
      'journal_entries', 'journal_lines', 'payroll', 'projects',
    ]);
  });
});
