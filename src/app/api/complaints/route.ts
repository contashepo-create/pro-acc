import { NextRequest } from 'next/server';
import { success, error, serverError, requireApiAuth, handleApiError, parseBody } from '@/lib/api-helpers';
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
      const { data: complaint, error: queryErr } = await s.from('complaints')
        .select('id, type, subject, body, status, admin_reply, created_at, updated_at')
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
    const body = await parseBody<any>(request);

    // محاولة استخراج توكن المصادقة إن وُجد لتسجيل الشكوى تحت حساب الشركة والملف الشخصي
    const { extractToken, verifyToken } = await import('@/lib/auth');
    const token = extractToken(request);
    let companyId: string | null = null;
    let userId: string | null = null;

    if (token) {
      const payload = verifyToken(token);
      if (payload) {
        const { data: user } = await s.from('users')
          .select('company_id')
          .eq('id', payload.userId)
          .maybeSingle();
        if (user) {
          companyId = user.company_id;
          userId = payload.userId;
        }
      }
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

    if (!subject.trim()) return error('العنوان مطلوب');
    if (!detailBody.trim()) return error('نص الشكوى أو الاقتراح مطلوب');

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
