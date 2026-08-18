import { NextRequest } from 'next/server';
import { getSupabase } from '@/lib/supabase-client';
import { requireAdmin, handleApiError, error, success, enforceRateLimit } from '@/lib/api-helpers';
import {
  parseBackupUploadBody, checkBackupOwnership, checkBackupSignature,
  validateBackupPayload, BackupValidationError, BACKUP_LIMITS,
} from '@/lib/backup-validation';

const sb = () => getSupabase();

/**
 * POST /api/backup/validate — dry-run inspection of a company backup file.
 *
 * Runs EVERY check the real restore applies (ownership, integrity signature,
 * backup_logs provenance, table allow-list, row shape, UUID ids, cross-company
 * rows, size/row caps) but writes NOTHING to business data, so the client can
 * first see whether the file matches the system and what would happen, and
 * only then call /api/backup/upload to actually apply it.
 */
export async function POST(request: NextRequest) {
  try {
    const auth = await requireAdmin(request);
    await enforceRateLimit(request, `backup-validate:${auth.userId}`);
    const s = sb();

    const { backupData, fileHash } = await parseBackupUploadBody(request);

    const { data: company } = await s.from('companies')
      .select('id, email').eq('id', auth.companyId).single();
    if (!company) return error('الشركة غير موجودة', 404);

    const ownership = checkBackupOwnership(
      backupData, auth.companyId, (company as Record<string, any>).email,
    );
    if (!ownership.ok) return error(ownership.message, ownership.status);

    const signature = checkBackupSignature(backupData, fileHash);
    if (!signature.ok) return error('بصمة ملف النسخة الاحتياطية غير صالحة', 400);

    const { data: logByHmac } = await s.from('backup_logs')
      .select('id')
      .eq('company_id', auth.companyId)
      .eq('hmac_signature', signature.expectedFullHmac)
      .maybeSingle();
    if (!logByHmac) {
      return error('النسخة الاحتياطية غير صالحة أو تم التلاعب بها. يجب أن تكون نفس الملف المحمل بدون تعديل', 400);
    }

    const report = validateBackupPayload(backupData, auth.companyId);

    // Record the inspection (audit-only write, scoped to this company).
    await s.from('security_audit_log').insert({
      company_id: auth.companyId,
      user_id: auth.userId,
      action: 'backup_validated',
      details: {
        file_hash: fileHash,
        valid: report.valid,
        tables: Object.keys(report.summary.tables),
        total_rows: report.summary.totalRows,
        issue_count: report.issues.length,
        issues: report.issues.slice(0, 20),
      },
      ip_address: request.headers.get('x-forwarded-for') || 'unknown',
    });

    return success({
      valid: report.valid,
      message: report.valid
        ? 'النسخة سليمة ومطابقة للنظام وجاهزة للتطبيق عبر مسار الاسترجاع'
        : 'النسخة تحتوي على مخالفات؛ لن يُسمح بتطبيقها',
      summary: report.summary,
      issues: report.issues.slice(0, 50),
      issueCount: report.issues.length,
      limits: BACKUP_LIMITS,
      nextStep: report.valid ? 'POST /api/backup/upload بنفس الملف للتنفيذ الفعلي' : 'أصلح الملف أو استخرج نسخة جديدة من النظام',
    });
  } catch (cause) {
    if (cause instanceof BackupValidationError) return error(cause.message, cause.status);
    return handleApiError(cause);
  }
}
