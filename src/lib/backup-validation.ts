/**
 * Shared, pure validation for company backup RESTORE payloads.
 *
 * Used by both the dry-run endpoint (/api/backup/validate) and the real
 * restore endpoint (/api/backup/upload), so the checks the client sees in the
 * "verify first" step are byte-for-byte the same checks the restore applies.
 * The database RPC (restore_company_backup_atomic) re-runs the same rules
 * inside the transaction as the final authority.
 *
 * Safety model (see docs/BACKUP_RESTORE_POLICY.md §Restore safety):
 *  - restore never DELETEs anything: rows are upserted (insert-or-update),
 *    so data that exists only in the live DB is never erased;
 *  - every row is forced to the authenticated company id;
 *  - rows whose id is already owned by ANOTHER company are rejected;
 *  - tables outside the allow-list are rejected;
 *  - the file must be a byte-identical export the system itself created
 *    (HMAC recorded in backup_logs at download time).
 */
import { createHmac, timingSafeEqual } from 'crypto';
import { getBackupSecret } from '@/lib/backup-integrity';

/** Tables the restore actually writes (small, tenant-safe reference data). */
export const RESTORE_TABLES = [
  'accounts', 'contacts', 'projects', 'banks_safes', 'inventory_items', 'employees',
] as const;

/** Tables a backup file may contain (mirrors the download endpoint + RPC). */
export const ALLOWED_BACKUP_TABLES = new Set<string>([
  'accounts', 'journal_entries', 'journal_lines', 'invoices', 'invoice_items',
  'contacts', 'clients', 'projects', 'banks_safes', 'cash_transactions',
  'inventory_items', 'employees', 'payroll',
]);

export interface BackupLimits {
  maxBodyBytes: number;
  maxRowsPerTable: number;
  maxTotalRows: number;
}

/** Hard limits that protect the serverless invocation from resource abuse. */
export const BACKUP_LIMITS: BackupLimits = {
  maxBodyBytes: 25 * 1024 * 1024, // 25 MB of JSON text
  maxRowsPerTable: 100_000,
  maxTotalRows: 500_000,
};

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export interface BackupIssue {
  table: string;
  row: number; // 1-based row index, 0 = table-level issue
  code: string;
  message: string;
}

export interface BackupValidationReport {
  valid: boolean;
  issues: BackupIssue[];
  summary: {
    tables: Record<string, { rows: number }>;
    totalRows: number;
  };
  limits: BackupLimits;
}

export interface BackupPayload {
  metadata?: {
    company_id?: string;
    email?: string;
    phone?: string;
    exported_at?: string;
    version?: string;
    format?: string;
  };
  data?: Record<string, unknown>;
}

export interface SignatureCheck {
  ok: boolean;
  expectedFullHmac: string;
}

/**
 * Read + parse the upload body with a hard byte-size cap BEFORE parsing, so
 * an oversized or non-JSON body cannot consume the serverless invocation.
 */
export async function parseBackupUploadBody(
  request: Request,
  maxBytes: number = BACKUP_LIMITS.maxBodyBytes,
): Promise<{ backupData: BackupPayload; fileHash: string }> {
  const raw = await request.text();
  if (Buffer.byteLength(raw, 'utf-8') > maxBytes) {
    throw new BackupValidationError('حجم ملف النسخة الاحتياطية أكبر من الحد المسموح (25 ميجابايت)', 413);
  }
  let body: unknown;
  try {
    body = JSON.parse(raw);
  } catch {
    throw new BackupValidationError('ملف النسخة الاحتياطية ليس JSON صالحاً', 400);
  }
  if (!body || typeof body !== 'object' || Array.isArray(body)) {
    throw new BackupValidationError('صيغة ملف النسخة الاحتياطية غير صحيحة', 400);
  }
  const { backupData, fileHash } = body as { backupData?: unknown; fileHash?: unknown };
  if (!backupData || typeof backupData !== 'object' || Array.isArray(backupData)) {
    throw new BackupValidationError('بيانات النسخ الاحتياطي مفقودة', 400);
  }
  if (typeof fileHash !== 'string' || !fileHash) {
    throw new BackupValidationError('بصمة ملف النسخة الاحتياطية مفقودة', 400);
  }
  return { backupData: backupData as BackupPayload, fileHash };
}

/**
 * Verify the file's integrity signature. The full HMAC is also what the
 * database requires to exist in backup_logs, so a file modified by a single
 * character can never pass.
 */
export function checkBackupSignature(backupData: BackupPayload, fileHash: string): SignatureCheck {
  const jsonString = JSON.stringify(backupData, null, 2);
  const expectedFullHmac = createHmac('sha256', getBackupSecret()).update(jsonString).digest('hex');
  const expectedHash = expectedFullHmac.substring(0, 16);
  const supplied = Buffer.from(String(fileHash), 'utf8');
  const calculated = Buffer.from(expectedHash, 'utf8');
  const ok = supplied.length === calculated.length && timingSafeEqual(supplied, calculated);
  return { ok, expectedFullHmac };
}

/**
 * The backup must describe THIS company: metadata.company_id must match and,
 * when the file carries the company email, it must match the current one.
 */
export function checkBackupOwnership(
  backupData: BackupPayload,
  authCompanyId: string,
  currentEmail?: string | null,
): { ok: boolean; status: number; message: string } {
  if (backupData.metadata?.company_id !== authCompanyId) {
    return { ok: false, status: 403, message: 'النسخة الاحتياطية لا تخص هذه الشركة' };
  }
  if (
    backupData.metadata.email
    && currentEmail
    && backupData.metadata.email.toLowerCase() !== currentEmail.toLowerCase()
  ) {
    return { ok: false, status: 400, message: 'البريد الإلكتروني في النسخة لا يطابق الشركة الحالية' };
  }
  return { ok: true, status: 200, message: '' };
}

/**
 * Structural validation of the payload's data section:
 *  - table allow-list
 *  - rows are arrays of plain objects
 *  - row ids are well-formed UUIDs
 *  - rows never carry another company's id
 *  - per-table and total row caps
 */
export function validateBackupPayload(
  backupData: BackupPayload,
  authCompanyId: string,
  limits: BackupLimits = BACKUP_LIMITS,
): BackupValidationReport {
  const issues: BackupIssue[] = [];
  const summary: BackupValidationReport['summary'] = { tables: {}, totalRows: 0 };
  const data = backupData.data ?? {};

  for (const [table, rows] of Object.entries(data)) {
    if (!ALLOWED_BACKUP_TABLES.has(table)) {
      issues.push({ table, row: 0, code: 'UNKNOWN_TABLE', message: `الجدول ${table} غير مسموح به في النسخة` });
      continue;
    }
    if (!Array.isArray(rows)) {
      issues.push({ table, row: 0, code: 'NOT_ARRAY', message: `بيانات الجدول ${table} غير صالحة` });
      continue;
    }
    if (rows.length > limits.maxRowsPerTable) {
      issues.push({
        table, row: 0, code: 'TOO_MANY_ROWS',
        message: `عدد سجلات الجدول ${table} يتجاوز الحد المسموح (${limits.maxRowsPerTable})`,
      });
      continue;
    }
    summary.tables[table] = { rows: rows.length };
    summary.totalRows += rows.length;
    rows.forEach((row: unknown, index: number) => {
      const rowNo = index + 1;
      if (!row || typeof row !== 'object' || Array.isArray(row)) {
        issues.push({ table, row: rowNo, code: 'BAD_ROW', message: `سجل غير صالح في جدول ${table} (صف ${rowNo})` });
        return;
      }
      const record = row as Record<string, unknown>;
      if (typeof record.id !== 'string' || !UUID_RE.test(record.id)) {
        issues.push({ table, row: rowNo, code: 'BAD_ID', message: `معرّف غير صالح في جدول ${table} (صف ${rowNo})` });
        return;
      }
      if (record.company_id !== undefined && record.company_id !== authCompanyId) {
        issues.push({
          table, row: rowNo, code: 'CROSS_COMPANY',
          message: `النسخة تحتوي على بيانات شركة أخرى في جدول ${table} (صف ${rowNo})`,
        });
      }
    });
  }

  if (summary.totalRows > limits.maxTotalRows) {
    issues.push({
      table: '*', row: 0, code: 'TOO_MANY_TOTAL_ROWS',
      message: `إجمالي السجلات يتجاوز الحد المسموح (${limits.maxTotalRows})`,
    });
  }

  return { valid: issues.length === 0, issues, summary, limits };
}

/** Thrown by the parsing helper; mapped to a clean HTTP status. */
export class BackupValidationError extends Error {
  status: number;
  constructor(message: string, status = 400) {
    super(message);
    this.name = 'BackupValidationError';
    this.status = status;
  }
}
