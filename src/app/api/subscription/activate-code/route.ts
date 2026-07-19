import { NextRequest } from 'next/server';
import { getSupabase } from '@/lib/supabase-client';
import { requireApiAuth, handleApiError, success, error, parseBody } from '@/lib/api-helpers';

const sb = () => getSupabase();

/**
 * POST /api/subscription/activate-code
 * تفعيل الاشتراك باستخدام كود تفعيل
 * الكود يتحكم في: نوع الباقة + المدة
 */
export async function POST(request: NextRequest) {
  try {
    const auth = await requireApiAuth(request);
    const s = sb();
    const body = await parseBody<{ code: string }>(request);
    const { code } = body;

    if (!code || code.trim().length === 0) {
      return error('كود التفعيل مطلوب');
    }

    // البحث عن الكود
    const { data: activationCode, error: codeErr } = await s.from('activation_codes')
      .select('*')
      .eq('code', code.trim())
      .maybeSingle();

    if (codeErr || !activationCode) {
      return error('كود التفعيل غير صحيح أو غير موجود');
    }

    const ac = activationCode as any;

    // التحقق من أن الكود لم يُستخدم
    if (ac.is_used) {
      return error('كود التفعيل مستخدم بالفعل');
    }

    // التحقق من أن الكود لم ينتهي
    if (ac.expires_at && new Date(ac.expires_at) < new Date()) {
      return error('كود التفعيل منتهي الصلاحية');
    }

    // جلب الباقة المرتبطة بالكود
    const { data: plan } = await s.from('subscription_plans')
      .select('*')
      .eq('code', ac.plan_code)
      .eq('is_active', true)
      .maybeSingle();

    if (!plan) {
      return error('الباقة المرتبطة بالكود غير موجودة أو معطلة');
    }

    const planData = plan as any;
    const durationMonths = ac.duration_months || 1;
    
    // حساب تاريخ الانتهاء
    const startDate = new Date();
    const endDate = new Date();
    endDate.setMonth(endDate.getMonth() + durationMonths);

    // البحث عن اشتراك حالي
    const { data: currentSub } = await s.from('subscriptions')
      .select('id, end_date')
      .eq('company_id', auth.companyId)
      .order('created_at', { ascending: false })
      .limit(1)
      .maybeSingle();

    if (currentSub) {
      // إذا كان الاشتراك الحالي نشط ولم ينتهي، نبدأ من تاريخ انتهائه
      const currentEnd = new Date((currentSub as any).end_date);
      const newStart = currentEnd > startDate ? currentEnd : startDate;
      const newEnd = new Date(newStart);
      newEnd.setMonth(newEnd.getMonth() + durationMonths);

      await s.from('subscriptions').update({
        plan_id: planData.id,
        plan_code: planData.code,
        status: 'active',
        start_date: newStart.toISOString().split('T')[0],
        end_date: newEnd.toISOString().split('T')[0],
        updated_at: new Date().toISOString(),
      }).eq('id', (currentSub as any).id);
    } else {
      // إنشاء اشتراك جديد
      await s.from('subscriptions').insert({
        company_id: auth.companyId,
        plan_id: planData.id,
        plan_code: planData.code,
        status: 'active',
        start_date: startDate.toISOString().split('T')[0],
        end_date: endDate.toISOString().split('T')[0],
      });
    }

    // تحديث الكود كـ "مستخدم"
    await s.from('activation_codes').update({
      is_used: true,
      used_by: auth.companyId,
      used_at: new Date().toISOString(),
    }).eq('id', ac.id);

    return success({
      message: `✅ تم تفعيل الباقة بنجاح!`,
      plan_name: planData.name || planData.description_ar || planData.code,
      duration_months: durationMonths,
      end_date: endDate.toISOString().split('T')[0],
    });
  } catch (err) {
    return handleApiError(err);
  }
}

/**
 * GET /api/subscription/activate-code
 * التحقق من كود بدون تفعيل
 */
export async function GET(request: NextRequest) {
  try {
    const auth = await requireApiAuth(request);
    const s = sb();
    const code = request.nextUrl.searchParams.get('code');

    if (!code) return error('كود التفعيل مطلوب');

    const { data: activationCode } = await s.from('activation_codes')
      .select('code, plan_code, duration_months, is_used, expires_at')
      .eq('code', code.trim())
      .maybeSingle();

    if (!activationCode) return error('كود غير صحيح');

    const ac = activationCode as any;

    // جلب اسم الباقة
    const { data: plan } = await s.from('subscription_plans')
      .select('name, description_ar')
      .eq('code', ac.plan_code)
      .maybeSingle();

    return success({
      valid: !ac.is_used && (!ac.expires_at || new Date(ac.expires_at) > new Date()),
      plan_code: ac.plan_code,
      plan_name: (plan as any)?.description_ar || (plan as any)?.name || ac.plan_code,
      duration_months: ac.duration_months,
      is_used: ac.is_used,
      expires_at: ac.expires_at,
    });
  } catch (err) {
    return handleApiError(err);
  }
}
