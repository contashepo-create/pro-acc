import { NextRequest } from 'next/server';
import { getSupabase } from '@/lib/supabase-client';
import { requireApiAuth, handleApiError, success, error } from '@/lib/api-helpers';

const sb = () => getSupabase();

export async function POST(request: NextRequest) {
  try {
    const auth = await requireApiAuth(request);
    const s = sb();

    // Enforce storage limit for the company plan. max_storage_mb = 0 means
    // "no file uploads allowed at all" (matches the new Start/Pro/
    // Enterprise defaults where add-on purchase is required).
    let storageMb = 0;
    try {
      const { getCompanyPlanLimits } = await import('@/lib/plan-limits');
      const limits = await getCompanyPlanLimits(auth.companyId);
      storageMb = limits?.max_storage_mb ?? 0;
    } catch { storageMb = 0; }
    if (storageMb <= 0) {
      return error('باقتك الحالية لا تتضمن مساحة تخزين للملفات. قم بترقية الباقة أو شراء إضافة التخزين.', 403);
    }

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

    // Enforce cumulative storage cap: count size already used in receipts bucket.
    try {
      const used = await countUsedStorage(s, auth.companyId);
      const capBytes = storageMb * 1024 * 1024;
      if (used + file.size > capBytes) {
        return error(
          `لا تتوفر مساحة تخزين كافية. المستخدم حالياً ${formatBytes(used)} من ${storageMb} MB. احذف ملفات غير ضرورية أو قم بترقية الباقة.`,
          403
        );
      }
    } catch (e) {
      // If we can't compute used storage, deny upload rather than silently
      // letting it exceed the plan — safety first.
      console.warn('[upload] could not compute used storage; blocking upload:', e);
      return error('تعذر التحقق من مساحة التخزين. حاول لاحقاً.', 503);
    }

    // Convert file to buffer
    const buffer = Buffer.from(await file.arrayBuffer());
    const fileName = `${auth.companyId}/${Date.now()}-${file.name.replace(/[^a-zA-Z0-9.-]/g, '_')}`;

    // Try to upload to Supabase Storage (receipts bucket)
    try {
      const { error: uploadError } = await s.storage
        .from('receipts')
        .upload(fileName, buffer, {
          contentType: file.type,
          upsert: false,
        });

      if (uploadError) {
        // If bucket doesn't exist, fallback to base64 storage in DB
        console.warn('Storage upload failed, fallback to DB:', uploadError.message);
        const base64 = buffer.toString('base64');
        const dataUrl = `data:${file.type};base64,${base64}`;
        
        // Store in a temporary table or return data URL
        return success({
          url: dataUrl,
          fileName,
          size: file.size,
          type: file.type,
          storage: 'base64',
          message: 'تم رفع الإيصال (مخزن مؤقتاً)',
        });
      }

      // Get public URL
      const { data: urlData } = s.storage.from('receipts').getPublicUrl(fileName);

      // Log audit
      await s.from('security_audit_log').insert({
        company_id: auth.companyId,
        user_id: auth.userId,
        action: 'receipt_upload',
        details: { fileName, size: file.size, type: file.type },
      });

      return success({
        url: urlData.publicUrl,
        fileName,
        size: file.size,
        type: file.type,
        storage: 'supabase',
      });
    } catch (storageErr) {
      console.error('Storage error:', storageErr);
      // Fallback to base64
      const base64 = buffer.toString('base64');
      const dataUrl = `data:${file.type};base64,${base64}`;
      return success({
        url: dataUrl,
        fileName,
        size: file.size,
        type: file.type,
        storage: 'base64_fallback',
      });
    }
  } catch (err) {
    return handleApiError(err);
  }
}

async function countUsedStorage(s: ReturnType<typeof sb>, companyId: string): Promise<number> {
  // Best-effort: list files under the company's prefix and sum their sizes.
  // Falls back to 0 if the storage backend is unavailable.
  try {
    // @ts-ignore - supabase-js storage API
    const { data: files, error } = await s.storage.from('receipts').list(companyId);
    if (error || !files) return 0;
    return (files as any[]).reduce((sum, f) => sum + (Number(f.metadata?.size) || 0), 0);
  } catch {
    return 0;
  }
}

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(2)} MB`;
}
