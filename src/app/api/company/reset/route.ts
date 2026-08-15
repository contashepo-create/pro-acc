import { NextRequest } from 'next/server';
import { success, error, serverError, requireAdmin, handleApiError, parseBody } from '@/lib/api-helpers';
import { getSupabase } from '@/lib/supabase-client';
import { createHash } from 'crypto';

const sb = () => getSupabase();

/**
 * POST /api/company/reset
 * واجهة إعادة تهيئة وتصفير بيانات الشركة من الصفر مع مصادقة ثنائية أمنية فائقة عبر تيليجرام
 * يدعم خطوتين:
 * 1. POST { action: 'request' } -> إرسال طلب الاعتماد لتيليجرام المدير لتوليد كود الـ 2FA
 * 2. POST { action: 'confirm', code: 'XXXXXX' } -> التحقق من كود الـ 2FA وتصفير البيانات بشكل معزول تماماً عن باقي الشركات
 */
export async function POST(request: NextRequest) {
  try {
    const auth = await requireAdmin(request);
    const s = sb();
    const body = await parseBody<{ action: string; code?: string }>(request);

    if (!body.action || !['request', 'confirm'].includes(body.action)) {
      return error('الإجراء (action) مطلوب ويجب أن يكون إما request أو confirm', 400);
    }

    // جلب إعدادات تليجرام للشركة للتأكد من تفعيل البوت
    const { data: config, error: configErr } = await s.from('company_telegram_configs')
      .select('*')
      .eq('company_id', auth.companyId)
      .maybeSingle();

    if (configErr || !config || !config.is_enabled || !config.chat_id) {
      return error('يجب تفعيل وربط بوت تيليجرام أولاً وحفظ معرف الدردشة (Chat ID) لتأمين عملية تصفير البيانات من الاختراق', 400);
    }

    const botToken = process.env.TELEGRAM_BOT_TOKEN && !process.env.TELEGRAM_BOT_TOKEN.startsWith('sk_')
      ? process.env.TELEGRAM_BOT_TOKEN
      : '';

    // ----------------------------------------------------
    // الخطوة 1: طلب تصفير البيانات وإرسال إشعار تليجرام للموافقة
    // ----------------------------------------------------
    if (body.action === 'request') {
      if (!botToken) return error('رمز بوت تيليجرام غير مهيأ في الخادم',503);
      const resetSession = {
        step: 'pending_telegram_approval',
        requested_at: new Date().toISOString(),
        requester_id: auth.userId
      };

      // حفظ جلسة الطلب في الإعدادات
      const { error: updateErr } = await s.from('company_telegram_configs')
        .update({ reset_session_data: resetSession })
        .eq('company_id', auth.companyId);

      if (updateErr) throw updateErr;

      // إرسال رسالة الاعتماد الأمني الحرج لتيليجرام المدير
      const message = `⚠️ <b>تنبيه أمني حرج للغاية!</b> 🚨

لقد تم تقديم طلب رسمي من داخل الموقع لإعادة تهيئة وتصفير كامل البيانات والقيود والعمليات المالية لشركتك من الصفر!

<b>اسم المسؤول:</b> <code>${auth.userId.slice(0, 8)}</code>

هل توافق على هذا الإجراء الحساس لتوليد رمز المصادقة الثنائية (2FA)؟`;

      const replyMarkup = {
        inline_keyboard: [
          [
            { text: "نعم، موافق وأريد الرمز ✅", callback_data: `reset:approve:${auth.companyId}` },
            { text: "لا، رفض وإلغاء الطلب ❌", callback_data: `reset:reject:${auth.companyId}` }
          ]
        ]
      };

      const response = await fetch(`https://api.telegram.org/bot${botToken}/sendMessage`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          chat_id: config.chat_id,
          text: message,
          parse_mode: 'HTML',
          reply_markup: replyMarkup
        })
      });

      if (!response.ok) {
        const errText = await response.text();
        console.error('Failed to send Telegram reset approval:', response.status, errText);
        await s.from('company_telegram_configs')
          .update({ reset_session_data: null })
          .eq('company_id', auth.companyId);
        return error('تعذر الاتصال بـ تيليجرام لإرسال طلب الموافقة. يرجى التأكد من أن البوت يعمل.');
      }

      return success({
        step: 'pending_telegram_approval',
        message: 'تم إرسال طلب أمني تفاعلي إلى تيليجرام المدير. يرجى الموافقة على الطلب هناك لتوليد رمز المصادقة ثنائي الأبعاد (2FA) وإدخاله هنا.'
      });
    }

    // ----------------------------------------------------
    // الخطوة 2: تأكيد الكود ومسح قاعدة البيانات بشكل معزول وآمن
    // ----------------------------------------------------
    if (body.action === 'confirm') {
      if (!body.code || !/^\d{6}$/.test(body.code)) {
        return error('كود المصادقة ثنائي الأبعاد (2FA) غير صالح، يجب أن يتكون من 6 أرقام', 400);
      }

      const codeHash=createHash('sha256').update(body.code.trim()).digest('hex');
      const { data: result, error: resetErr } = await s.rpc('reset_company_business_data', {
        p_company_id:auth.companyId,
        p_user_id:auth.userId,
        p_code_hash:codeHash,
      });
      if (resetErr) throw resetErr;
      const status=(result as Record<string,any>)?.status;
      if (status==='not_approved') return error('لم تتم الموافقة على طلب التصفير من تيليجرام بعد',400);
      if (status==='wrong_requester') return error('يجب أن يؤكد التصفير نفس المسؤول الذي طلبه',403);
      if (status==='expired') return error('انتهت صلاحية رمز المصادقة؛ قدم طلباً جديداً',400);
      if (status==='invalid_code') return error(`رمز المصادقة غير صحيح. المحاولات المتبقية: ${(result as any).attempts_remaining}`,400);
      if (status==='locked') return error('تم إلغاء الطلب بعد تجاوز عدد المحاولات المسموح',429);
      if (status!=='reset_success') throw new Error('نتيجة تصفير غير متوقعة');
      return success({
        ...(result as Record<string,any>),
        message:'تم تصفير بيانات الشركة داخل معاملة واحدة بنجاح، مع الإبقاء على الهوية والاشتراك والإعدادات ودليل الحسابات.',
      });
    }

    return error('عملية غير صالحة');
  } catch (err) {
    return handleApiError(err);
  }
}
