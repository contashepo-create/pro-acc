import { NextRequest } from 'next/server';
import { getSupabase } from '@/lib/supabase-client';
import { requireApiAuth, handleApiError, success, error } from '@/lib/api-helpers';

// @ts-ignore
const sb = () => getSupabase() as any;

export async function POST(request: NextRequest) {
  try {
    const auth = await requireApiAuth(request);
    const s = sb();

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

    // Validate size (max 5MB)
    if (file.size > 5 * 1024 * 1024) {
      return error('حجم الملف كبير جداً. الحد الأقصى 5MB');
    }

    // Convert file to buffer
    const buffer = Buffer.from(await file.arrayBuffer());
    const fileName = `${auth.companyId}/${Date.now()}-${file.name.replace(/[^a-zA-Z0-9.-]/g, '_')}`;

    // Try to upload to Supabase Storage (receipts bucket)
    try {
      const { data: uploadData, error: uploadError } = await s.storage
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
