import { NextRequest } from 'next/server';
import { getSupabase } from '@/lib/supabase-client';
import { requireAdmin, handleApiError, error, success, parseBody } from '@/lib/api-helpers';
import { createHmac, timingSafeEqual } from 'crypto';
import { getBackupSecret } from '@/lib/backup-integrity';

const sb = () => getSupabase();

export async function POST(request: NextRequest) {
  try {
    // SECURITY: استعادة/استبدال بيانات الشركة — مدير النظام فقط
    const auth = await requireAdmin(request);
    const s = sb();

    const { backupData, fileHash } = await parseBody<{ backupData?: Record<string, any>; fileHash?: string }>(request);

    if (!backupData || !fileHash) {
      return error('بيانات النسخ الاحتياطي مفقودة');
    }

    // Verify company matches
    const { data: company } = await s.from('companies').select('id, name, email, phone').eq('id', auth.companyId).single();
    if (!company) return error('Company not found', 404);

    const c = company as Record<string, any>;

    // Verify metadata matches current company
    if (backupData.metadata?.company_id !== auth.companyId) {
      return error('النسخة الاحتياطية لا تخص هذه الشركة', 403);
    }
    if (backupData.metadata?.email && backupData.metadata.email.toLowerCase() !== c.email?.toLowerCase()) {
      return error('البريد الإلكتروني في النسخة لا يطابق الشركة الحالية', 400);
    }
    if (backupData.metadata?.phone && backupData.metadata.phone !== c.phone) {
      // Allow but log warning
      console.warn(`Phone mismatch for backup: ${backupData.metadata.phone} vs ${c.phone}`);
    }

    // Verify HMAC signature to ensure not tampered
    const jsonString = JSON.stringify(backupData, null, 2);
    const expectedFullHmac = createHmac('sha256', getBackupSecret()).update(jsonString).digest('hex');
    const expectedHash = expectedFullHmac.substring(0, 16);
    const suppliedHash = Buffer.from(String(fileHash), 'utf8');
    const calculatedHash = Buffer.from(expectedHash, 'utf8');
    if (suppliedHash.length !== calculatedHash.length || !timingSafeEqual(suppliedHash, calculatedHash)) {
      return error('بصمة ملف النسخة الاحتياطية غير صالحة', 400);
    }

    // Secure verification: search database logs for a record matching the CALCULATED full hmac signature of the actual uploaded content.
    // If the content was modified by even one character, the calculated HMAC will change, and it will not find any log entry.
    const { data: logByHmac } = await s.from('backup_logs')
      .select('id')
      .eq('company_id', auth.companyId)
      .eq('hmac_signature', expectedFullHmac)
      .maybeSingle();

    if (!logByHmac) {
      return error('النسخة الاحتياطية غير صالحة أو تم التلاعب بها. يجب أن تكون نفس الملف المحمل بدون تعديل', 400);
    }

    // Verify no data leakage and reject unexpected tables/types. Restore is
    // intentionally limited to the small, documented set below.
    const restoreOrder = ['accounts', 'contacts', 'projects', 'banks_safes', 'inventory_items', 'employees'] as const;
    const allowedBackupTables = new Set<string>([
      'accounts', 'journal_entries', 'journal_lines', 'invoices', 'invoice_items',
      'contacts', 'clients', 'projects', 'banks_safes', 'cash_transactions',
      'inventory_items', 'employees', 'payroll',
    ]);
    for (const [table, rows] of Object.entries(backupData.data || {})) {
      if (!allowedBackupTables.has(table)) return error(`الجدول ${table} غير مسموح به في النسخة`, 400);
      if (!Array.isArray(rows)) return error(`بيانات الجدول ${table} غير صالحة`, 400);
      for (const row of rows) {
        if (!row || typeof row !== 'object' || Array.isArray(row)) return error(`سجل غير صالح في جدول ${table}`, 400);
        if ((row as Record<string, unknown>).company_id && (row as Record<string, unknown>).company_id !== auth.companyId) {
          return error(`النسخة تحتوي على بيانات شركة أخرى في جدول ${table}`, 400);
        }
      }
    }

    // Audit log before restore
    await s.from('security_audit_log').insert({
      company_id: auth.companyId,
      user_id: auth.userId,
      action: 'backup_upload_attempt',
      details: { file_hash: fileHash, tables: Object.keys(backupData.data || {}) },
      ip_address: request.headers.get('x-forwarded-for') || 'unknown',
    });

    // One database transaction performs all supported-table writes. The RPC
    // re-verifies the administrator, company, HMAC log, table allow-list and
    // every row's tenant before touching data. Any failure rolls everything
    // back, rather than leaving a partially restored company.
    const { data: restoreResult, error: restoreError } = await s.rpc('restore_company_backup_atomic', {
      p_company_id: auth.companyId,
      p_user_id: auth.userId,
      p_hmac_signature: expectedFullHmac,
      p_data: backupData.data || {},
    });
    if (restoreError) throw restoreError;

    return success({
      message: 'تم استعادة النسخة الاحتياطية بنجاح',
      restoredTables: Object.keys(backupData.data || {}).filter((table) => restoreOrder.includes(table as any)),
      result: restoreResult,
    });
  } catch (err) {
    return handleApiError(err);
  }
}
