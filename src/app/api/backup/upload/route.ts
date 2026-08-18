import { NextRequest } from 'next/server';
import { getSupabase } from '@/lib/supabase-client';
import { requireAdmin, handleApiError, error, success, enforceRateLimit } from '@/lib/api-helpers';
import {
  parseBackupUploadBody, checkBackupOwnership, checkBackupSignature,
  validateBackupPayload, BackupValidationError, RESTORE_TABLES,
} from '@/lib/backup-validation';

const sb = () => getSupabase();

/**
 * POST /api/backup/upload — apply a company backup file.
 *
 * Safety model (verified end-to-end, see docs/BACKUP_RESTORE_POLICY.md):
 *  1. Only the company admin, rate limited.
 *  2. The file must be a byte-identical export the system itself created:
 *     HMAC signature verified in-process AND a matching hmac_signature must
 *     exist in backup_logs (a modified or foreign file can never pass).
 *  3. Ownership: metadata.company_id (+ email) must match this company.
 *  4. Structure: table allow-list, row shape, UUID ids, row/byte caps,
 *     and every row must not carry another company's data.
 *  5. The atomic RPC re-verifies ALL of the above inside one transaction and
 *     upserts only the six reference tables, scoped to this company. Restore
 *     NEVER deletes: rows that exist only in the live database stay intact,
 *     and rows whose id belongs to another company abort the whole restore.
 *  6. Any failure rolls the entire transaction back — no partial restore.
 */
export async function POST(request: NextRequest) {
  try {
    const auth = await requireAdmin(request);
    await enforceRateLimit(request, `backup-restore:${auth.userId}`);
    const s = sb();

    const { backupData, fileHash } = await parseBackupUploadBody(request);

    // Verify company matches
    const { data: company } = await s.from('companies')
      .select('id, name, email, phone').eq('id', auth.companyId).single();
    if (!company) return error('Company not found', 404);
    const c = company as Record<string, any>;

    const ownership = checkBackupOwnership(backupData, auth.companyId, c.email);
    if (!ownership.ok) return error(ownership.message, ownership.status);
    if (backupData.metadata?.phone && backupData.metadata.phone !== c.phone) {
      console.warn(`Phone mismatch for backup: ${backupData.metadata.phone} vs ${c.phone}`);
    }

    const signature = checkBackupSignature(backupData, fileHash);
    if (!signature.ok) return error('بصمة ملف النسخة الاحتياطية غير صالحة', 400);

    // Secure provenance: the CALCULATED full HMAC of the actual uploaded
    // content must match a backup_logs entry created by the download
    // endpoint. One changed character = different HMAC = no log entry.
    const { data: logByHmac } = await s.from('backup_logs')
      .select('id')
      .eq('company_id', auth.companyId)
      .eq('hmac_signature', signature.expectedFullHmac)
      .maybeSingle();
    if (!logByHmac) {
      return error('النسخة الاحتياطية غير صالحة أو تم التلاعب بها. يجب أن تكون نفس الملف المحمل بدون تعديل', 400);
    }

    // Structural validation with hard caps (same checks the validate endpoint
    // reports, enforced again here before any data is touched).
    const report = validateBackupPayload(backupData, auth.companyId);
    if (!report.valid) {
      return error(report.issues[0]?.message || 'النسخة تحتوي على مخالفات؛ لن يُسمح بتطبيقها', 400);
    }

    // Audit log before restore
    await s.from('security_audit_log').insert({
      company_id: auth.companyId,
      user_id: auth.userId,
      action: 'backup_upload_attempt',
      details: {
        file_hash: fileHash,
        tables: Object.keys(report.summary.tables),
        total_rows: report.summary.totalRows,
      },
      ip_address: request.headers.get('x-forwarded-for') || 'unknown',
    });

    // One database transaction performs all supported-table writes. The RPC
    // re-verifies the administrator, company, HMAC log, table allow-list and
    // every row's tenant before touching data. Any failure rolls everything
    // back, rather than leaving a partially restored company.
    const { data: restoreResult, error: restoreError } = await s.rpc('restore_company_backup_atomic', {
      p_company_id: auth.companyId,
      p_user_id: auth.userId,
      p_hmac_signature: signature.expectedFullHmac,
      p_data: backupData.data || {},
    });
    if (restoreError) throw restoreError;

    return success({
      message: 'تم استعادة النسخة الاحتياطية بنجاح',
      restoredTables: Object.keys(report.summary.tables).filter((table) =>
        (RESTORE_TABLES as readonly string[]).includes(table)),
      result: restoreResult,
    });
  } catch (cause) {
    if (cause instanceof BackupValidationError) return error(cause.message, cause.status);
    return handleApiError(cause);
  }
}
