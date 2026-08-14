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

    // download_url is stored as data:application/json;...;base64,<payload>
    let jsonText: string;
    const marker = ';base64,';
    const idx = e.download_url.indexOf(marker);
    if (e.download_url.startsWith('data:') && idx !== -1) {
      jsonText = Buffer.from(e.download_url.slice(idx + marker.length), 'base64').toString('utf8');
    } else if (/^https?:\/\//.test(e.download_url)) {
      // Future-proof: if exports move to object storage, redirect.
      return NextResponse.redirect(e.download_url);
    } else {
      jsonText = e.download_url;
    }

    return new NextResponse(jsonText, {
      status: 200,
      headers: {
        'Content-Type': 'application/json; charset=utf-8',
        'Content-Disposition': `attachment; filename="pro-acc-export-${id}.json"`,
        'Cache-Control': 'no-store',
      },
    });
  } catch (e) {
    return handleApiError(e);
  }
}
