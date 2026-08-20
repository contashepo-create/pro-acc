import { NextRequest } from 'next/server';
import { randomUUID } from 'crypto';
import { getSupabase } from '@/lib/supabase-client';
import { hasAllowedMagicBytes } from '@/lib/safe-input';
import { requireApiAuth, handleApiError, success, error } from '@/lib/api-helpers';

const sb = () => getSupabase();

export async function POST(request: NextRequest) {
  try {
    const auth = await requireApiAuth(request);
    const s = sb();

    // A payment proof is required in order to buy a plan or storage add-on,
    // including when the current plan has no billable document storage. Keep
    // these proofs in a dedicated, tightly capped area instead of applying the
    // plan's general file-storage entitlement (which created a circular flow:
    // users needed storage before they could submit the receipt to buy it).
    const formData = await request.formData();
    const file = formData.get('file') as File;

    if (!file) {
      return error('الملف مطلوب');
    }

    // Validate file type
    const allowedTypes = ['image/jpeg', 'image/png', 'image/jpg', 'application/pdf'];
    if (!allowedTypes.includes(file.type)) {
      return error('نوع الملف غير مدعوم. الأنواع المدعومة: JPG, PNG, PDF');
    }

    // Validate size (per-file cap 5MB)
    if (file.size > 5 * 1024 * 1024) {
      return error('حجم الملف كبير جداً. الحد الأقصى 5MB');
    }

    // Payment evidence is exempt from the purchased document-storage quota,
    // but still has its own anti-abuse cap per tenant.
    const proofDirectory = `${auth.companyId}/payment-proofs`;
    const proofStorageCap = 50 * 1024 * 1024;
    let used = 0;
    try {
      used = await countDirectoryBytes(s, proofDirectory);
    } catch (e) {
      console.warn('[receipt-upload] could not compute proof storage:', e);
      return error('تعذر التحقق من مساحة إيصالات الدفع. حاول لاحقاً.', 503);
    }
    if (used + file.size > proofStorageCap) {
      return error(
        `تم الوصول للحد الآمن لإيصالات الدفع (${formatBytes(proofStorageCap)}). تواصل مع الدعم لحذف الإيصالات القديمة.`,
        403
      );
    }

    // Content-Type is caller-controlled. Verify the actual signature before
    // sending any bytes to storage.
    const buffer = Buffer.from(await file.arrayBuffer());
    if (!hasAllowedMagicBytes(buffer, file.type)) {
      return error('محتوى الملف لا يطابق نوع JPG/PNG/PDF المسموح');
    }
    const extension = file.type === 'application/pdf' ? 'pdf'
      : file.type === 'image/png' ? 'png' : 'jpg';
    const fileName = `${proofDirectory}/${randomUUID()}.${extension}`;

    // Try to upload to Supabase Storage (receipts bucket)
    try {
      const { error: uploadError } = await s.storage
        .from('receipts')
        .upload(fileName, buffer, {
          contentType: file.type,
          upsert: false,
        });

      if (uploadError) {
        // Do not return an untracked data: URL. It defeats storage accounting,
        // can leak a receipt through client state/logs, and is not durable.
        console.error('Storage upload failed:', uploadError.message);
        return error('تعذر حفظ الملف في التخزين الآمن. حاول لاحقاً.', 503);
      }

      // Receipts are financial evidence. Serve a short-lived signed URL; the
      // persistent database reference is the private object path (`fileName`).
      const { data: signed, error: signedError } = await s.storage
        .from('receipts')
        .createSignedUrl(fileName, 15 * 60);
      if (signedError || !signed?.signedUrl) {
        await s.storage.from('receipts').remove([fileName]);
        return error('تعذر إنشاء رابط آمن للملف', 503);
      }

      // Log audit
      await s.from('security_audit_log').insert({
        company_id: auth.companyId,
        user_id: auth.userId,
        action: 'receipt_upload',
        details: { fileName, size: file.size, type: file.type },
      });

      return success({
        url: signed.signedUrl,
        reference: fileName,
        fileName,
        size: file.size,
        type: file.type,
        storage: 'supabase',
      });
    } catch (storageErr) {
      console.error('Storage error:', storageErr);
      return error('تعذر حفظ الملف في التخزين الآمن. حاول لاحقاً.', 503);
    }
  } catch (err) {
    return handleApiError(err);
  }
}

async function countDirectoryBytes(storageClient: ReturnType<typeof getSupabase>, directory: string): Promise<number> {
  let total = 0;
  let offset = 0;
  const pageSize = 1000;
  while (true) {
    const { data, error: listError } = await storageClient.storage.from('receipts').list(directory, {
      limit: pageSize,
      offset,
      sortBy: { column: 'name', order: 'asc' },
    });
    if (listError) throw listError;
    const files = data || [];
    for (const file of files) {
      const size = Number(file.metadata?.size);
      if (Number.isFinite(size) && size > 0) total += size;
    }
    if (files.length < pageSize) return total;
    offset += pageSize;
    if (offset > 50_000) throw new Error('Receipt storage listing exceeded safe limit');
  }
}

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(2)} MB`;
}
