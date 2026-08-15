import { NextRequest, NextResponse } from 'next/server';
import { error, handleApiError } from '@/lib/api-helpers';
import { getSupabase } from '@/lib/supabase-client';

const sb = () => getSupabase();

/**
 * GET /api/company/data-export/[id]/download
 * Streams the generated JSON export as a real file download.
 * The list endpoint intentionally omits the payload (it can be MBs);
 * this endpoint serves it with proper Content-Disposition headers so the
 * browser downloads `pro-acc-export-<id>.json` instead of choking on a
 * giant data: URL.
 */
export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { requireApiAuth } = await import('@/lib/api-helpers');
    const auth = await requireApiAuth(req, { skipModuleGuard: true });
    if (auth.role !== 'admin') return error('تحميل تصدير الشركة متاح لمدير الشركة فقط', 403);
    const { id } = await params;
    const s = sb();

    const { data: exp, error: err } = await s.from('company_data_exports')
      .select('id, status, download_url, expires_at')
      .eq('id', id)
      .eq('company_id', auth.companyId)
      .maybeSingle();
    if (err) throw err;
    if (!exp) return error('طلب التصدير غير موجود', 404);

    const e = exp as { status: string; download_url: string | null; expires_at: string | null };
    if (e.status !== 'ready' || !e.download_url) {
      return error('الملف غير جاهز بعد', 409);
    }
    if (e.expires_at && new Date(e.expires_at).getTime() < Date.now()) {
      return error('انتهت صلاحية رابط التحميل. اطلب تصديراً جديداً.', 410);
    }

    if (e.download_url.startsWith('storage:company-exports/')) {
      const objectPath = e.download_url.slice('storage:company-exports/'.length);
      if (!objectPath.startsWith(`${auth.companyId}/`) || objectPath.includes('..')) {
        return error('مرجع ملف التصدير غير صالح', 500);
      }
      const { data: signed, error: signError } = await s.storage
        .from('company-exports')
        .createSignedUrl(objectPath, 60);
      if (signError || !signed?.signedUrl) return error('تعذر إنشاء رابط تحميل آمن', 503);
      return NextResponse.redirect(signed.signedUrl, { status: 303 });
    }

    // One-release compatibility for exports generated before migration 049.
    // They are streamed and never exposed in a query string or redirect.
    const marker = ';base64,';
    const idx = e.download_url.indexOf(marker);
    if (e.download_url.startsWith('data:application/json') && idx !== -1) {
      const jsonText = Buffer.from(e.download_url.slice(idx + marker.length), 'base64').toString('utf8');
      return new NextResponse(jsonText, {
        status: 200,
        headers: {
          'Content-Type': 'application/json; charset=utf-8',
          'Content-Disposition': `attachment; filename="pro-acc-export-${id}.json"`,
          'Cache-Control': 'no-store',
        },
      });
    }
    return error('مرجع ملف التصدير غير صالح', 500);
  } catch (e) {
    return handleApiError(e);
  }
}
