import { NextRequest, NextResponse } from 'next/server';
import { error, handleApiError, requireModulePermission } from '@/lib/api-helpers';
import { getSupabase } from '@/lib/supabase-client';
import { relationshipUuid } from '@/lib/relationship-validation';

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string; documentId: string }> },
) {
  try {
    const auth = await requireModulePermission(request, 'contracts', 'read');
    const { id, documentId } = await params;
    if (!relationshipUuid.safeParse(id).success || !relationshipUuid.safeParse(documentId).success) {
      return error('معرف المستند غير صالح');
    }
    const s = getSupabase();
    const { data: document, error: documentError } = await s.from('contract_documents').select('id, file_data')
      .eq('id', documentId).eq('contract_id', id).eq('company_id', auth.companyId).maybeSingle();
    if (documentError) throw documentError;
    if (!document) return error('المستند غير موجود', 404);
    const reference = String((document as { file_data?: unknown }).file_data || '');
    if (!reference.startsWith('storage:contract-documents/')) return error('المستند القديم غير متاح عبر التخزين الآمن', 410);
    const objectPath = reference.slice('storage:contract-documents/'.length);
    if (!objectPath.startsWith(`${auth.companyId}/${id}/`) || objectPath.includes('..')) return error('مرجع المستند غير صالح', 500);
    const { data: signed, error: signError } = await s.storage.from('contract-documents').createSignedUrl(objectPath, 60);
    if (signError || !signed?.signedUrl) return error('تعذر إنشاء رابط المستند', 503);
    return NextResponse.redirect(signed.signedUrl, { status: 303 });
  } catch (err) {
    return handleApiError(err);
  }
}
