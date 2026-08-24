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
    const { data: document, error: documentError } = await s.from('contract_documents').select('id, file_data, filename, content_type')
      .eq('id', documentId).eq('contract_id', id).eq('company_id', auth.companyId).maybeSingle();
    if (documentError) throw documentError;
    if (!document) return error('المستند غير موجود', 404);
    const row = document as { file_data?: unknown; filename?: unknown; content_type?: unknown };
    const reference = String(row.file_data || '');
    if (!reference.startsWith('storage:contract-documents/')) return error('المستند القديم غير متاح عبر التخزين الآمن', 410);
    const objectPath = reference.slice('storage:contract-documents/'.length);
    if (!objectPath.startsWith(`${auth.companyId}/${id}/`) || objectPath.includes('..')) return error('مرجع المستند غير صالح', 500);
    if (!s.storage) return error('تعذر إنشاء رابط المستند', 503);
    const { data: signed, error: signError } = await s.storage.from('contract-documents').createSignedUrl(objectPath, 60);
    if (signError || !signed?.signedUrl) return error('تعذر إنشاء رابط المستند', 503);

    // SECURITY: stream the object instead of redirecting to the signed URL.
    // The signed URL never reaches the browser (no history/log leakage, no
    // window to be replayed from a shared machine), and Content-Disposition
    // forces a download — the browser is never invited to render a poisoned
    // file inline.
    let fileResponse: globalThis.Response;
    try {
      fileResponse = await fetch(signed.signedUrl, { signal: AbortSignal.timeout(30_000) });
    } catch {
      return error('تعذر جلب المستند من التخزين الآمن', 503);
    }
    if (!fileResponse.ok || !fileResponse.body) {
      return error('تعذر جلب المستند من التخزين الآمن', 502);
    }
    const safeName = sanitizeDownloadFilename(String(row.filename || `document-${documentId}`));
    return new NextResponse(fileResponse.body, {
      status: 200,
      headers: {
        'Content-Type': String(row.content_type || 'application/octet-stream'),
        'Content-Disposition': `attachment; filename="${safeName}"`,
        'Content-Length': fileResponse.headers.get('content-length') || '',
        'Cache-Control': 'no-store',
        'X-Content-Type-Options': 'nosniff',
        'Cross-Origin-Resource-Policy': 'same-origin',
      },
    });
  } catch (err) {
    return handleApiError(err);
  }
}

/** Keep only filename-safe characters (Arabic letters included). */
function sanitizeDownloadFilename(name: string): string {
  return name.replace(/[^\w.\-\u0600-\u06FF ()]/g, '_').slice(0, 200) || 'document';
}
