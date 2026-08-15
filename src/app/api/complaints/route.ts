import { NextRequest } from 'next/server';
import { success, error, serverError, requireApiAuth, handleApiError, parseBody, enforceRateLimit } from '@/lib/api-helpers';
import { getSupabase } from '@/lib/supabase-client';

const sb = () => getSupabase();

/**
 * GET /api/complaints
 * يدعم الاستخدامين:
 * 1. عام (دون مصادقة): لتتبع شكوى محددة باستخدام tracking_id من صفحة الهبوط العامة
 * 2. خاص (بمصادقة): لجلب آخر 50 شكوى خاصة بالشركة المسجلة
 */
export async function GET(request: NextRequest) {
  try {
    const s = sb();
    const { searchParams } = new URL(request.url);
    const trackingId = searchParams.get('tracking_id');

    // الحالة 1: تتبع شكوى محددة علناً بالمعرف (Tracking ID)
    if (trackingId) {
      const ip = request.headers.get('x-forwarded-for')?.split(',')[0]?.trim() || 'unknown';
      await enforceRateLimit(request, `complaint-track:${ip}`);
      if (!/^[0-9a-fA-F-]{8,}$/.test(trackingId)) return error('لم يتم العثور على الشكوى بموجب هذا المعرّف', 404);
      const { data: complaint, error: queryErr } = await s.from('complaints')
        // Public tracking deliberately excludes the original body because it
        // may contain visitor names, email addresses and support details.
        .select('id, type, subject, status, admin_reply, created_at, updated_at')
        .eq('id', trackingId)
        .maybeSingle();

      if (queryErr) throw queryErr;
      if (!complaint) return error('لم يتم العثور على الشكوى بموجب هذا المعرّف', 404);

      return success(complaint);
    }

    // الحالة 2: جلب شكاوى الشركة المسجلة (يتطلب مصادقة)
    const { companyId } = await requireApiAuth(request);
    const { data: complaints, error: listErr } = await s.from('complaints')
      .select('id, type, subject, body, status, admin_reply, created_at, updated_at, users(name)')
      .eq('company_id', companyId)
      .order('created_at', { ascending: false })
      .limit(50);

    if (listErr) throw listErr;

    // مواءمة شكل الاستجابة مع واجهة لوحة التحكم (complaints[]) + اسم المستخدم
    const rows = (complaints || []).map((c: any) => ({
      ...c,
      user_name: c.users?.name || null,
    }));

    return success({ complaints: rows });
  } catch (err) {
    if (err instanceof Error && err.message === 'غير مصرح به') return handleApiError(err);
    return serverError(err);
  }
}

/**
 * POST /api/complaints
 * يدعم الاستخدامين:
 * 1. عام (دون مصادقة): لإرسال شكوى/اقتراح من زائر الموقع العام (يتم حفظ الاسم والبريد مدمجين في حقل النص)
 * 2. خاص (بمصادقة): لإرسال شكوى من داخل لوحة تحكم الشركة
 */
export async function POST(request: NextRequest) {
  try {
    const s = sb();
    const ip = request.headers.get('x-forwarded-for')?.split(',')[0]?.trim() || 'unknown';
    await enforceRateLimit(request, `complaint-create:${ip}`);
    const body = await parseBody<any>(request);

    // If a session is presented it must pass the full active-user/token-version
    // checks. Invalid/stale sessions do not silently downgrade to anonymous.
    const { extractToken } = await import('@/lib/auth');
    const token = extractToken(request);
    let companyId: string | null = null;
    let userId: string | null = null;
    if (token) {
      const auth = await requireApiAuth(request, { checkSubscription: false });
      companyId = auth.companyId;
      userId = auth.userId;
    }

    // موائمة بيانات الواجهة الأمامية العامة مع حقول قاعدة البيانات
    const rawType = body.type || 'complaint';
    // أنواع البلاغات الداخلية (أخطاء كشوف الحساب، بلاغات أخرى) تُطبَّع إلى
    // 'complaint' لأن عمود type مقيد بـ (complaint, suggestion) في القاعدة.
    const type = ['complaint', 'suggestion'].includes(rawType) ? rawType : 'complaint';
    const subject = body.subject || '';
    let detailBody = body.body || '';

    // إذا جاءت المدخلات من صفحة الهبوط العامة { name, email, subject, message }
    if (body.message) {
      detailBody = body.message;
    }
    if (body.name || body.email) {
      detailBody = `اسم المرسل: ${body.name || 'غير معروف'}\nبريد المرسل: ${body.email || 'غير معروف'}\n\nالرسالة:\n${detailBody}`;
    }

    if (typeof subject !== 'string' || !subject.trim() || subject.length > 200) return error('العنوان مطلوب وبحد أقصى 200 حرف');
    if (typeof detailBody !== 'string' || !detailBody.trim() || detailBody.length > 5000) return error('نص الشكوى مطلوب وبحد أقصى 5000 حرف');
    if (body.name !== undefined && (typeof body.name !== 'string' || body.name.length > 120)) return error('اسم المرسل غير صالح');
    if (body.email !== undefined && (typeof body.email !== 'string' || body.email.length > 254 || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(body.email))) return error('البريد الإلكتروني غير صالح');

    const { data: result, error: insertError } = await s.from('complaints')
      .insert({
        company_id: companyId,
        user_id: userId,
        type: type,
        subject: subject.trim(),
        body: detailBody.trim(),
      })
      .select('id, type, subject, body, status, created_at')
      .single();

    if (insertError) throw insertError;
    return success(result, 201);
  } catch (err) {
    return serverError(err);
  }
}
