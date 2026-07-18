import { NextRequest } from 'next/server';
import { success, error, serverError, requireApiAuth, handleApiError } from '@/lib/api-helpers';
import { getSupabase } from '@/lib/supabase-client';
import { checkModuleAccess } from '@/lib/usage-limits';

const sb = () => getSupabase();

/**
 * GET /api/settings/telegram/test
 * الاستعلام عن حالة فحص الربط التفاعلي للـ Test Run
 */
export async function GET(request: NextRequest) {
  try {
    const auth = await requireApiAuth(request);
    const { searchParams } = new URL(request.url);
    const testRunId = searchParams.get('test_run_id');

    if (!testRunId) {
      return error('test_run_id مطلوب');
    }

    const s = sb();
    const { data: testRun, error: queryErr } = await s.from('telegram_test_runs')
      .select('*')
      .eq('id', testRunId)
      .eq('company_id', auth.companyId)
      .maybeSingle();

    if (queryErr) throw queryErr;
    if (!testRun) return error('لم يتم العثور على فحص الربط المطلوب', 404);

    return success({
      testRunId: testRun.id,
      status: testRun.status, // pending, accepted, rejected, expired
      updatedAt: testRun.updated_at
    });

  } catch (err) {
    return handleApiError(err);
  }
}

/**
 * POST /api/settings/telegram/test
 * إطلاق عملية فحص ربط جديدة تفاعلية وإرسال الأزرار المشفرة للبوت
 */
export async function POST(request: NextRequest) {
  try {
    const auth = await requireApiAuth(request);
    const s = sb();

    // 1. التحقق من تمكين الميزة للباقة
    const isAllowed = await checkModuleAccess(auth.companyId, 'telegram_integration');
    if (!isAllowed) {
      return error('هذه الميزة غير متوفرة في باقتك الحالية. يرجى ترقية الاشتراك.', 403);
    }

    // 2. جلب إعدادات التليجرام الحالية للشركة للتأكد من ربط المعرف
    const { data: config } = await s.from('company_telegram_configs')
      .select('chat_id, is_enabled')
      .eq('company_id', auth.companyId)
      .maybeSingle();

    const chatId = config?.chat_id;
    if (!chatId || chatId.trim() === '') {
      return error('يرجى تعيين وحفظ "معرف الدردشة" (Chat ID) أولاً قبل إطلاق الفحص التفاعلي');
    }

    // 3. إنشاء سجل فحص جديد بحالة انتظار (pending)
    const { data: testRun, error: insertErr } = await s.from('telegram_test_runs')
      .insert({
        company_id: auth.companyId,
        status: 'pending'
      })
      .select('id')
      .single();

    if (insertErr || !testRun) throw insertErr || new Error('Failed to create test run record');

    const testRunId = testRun.id;

    // 4. إرسال الرسالة التفاعلية وبها أزرار تليجرام المدمجة (Inline Buttons)
    const botToken = process.env.TELEGRAM_BOT_TOKEN;
    if (!botToken) {
      return error('رمز البوت العالمي (TELEGRAM_BOT_TOKEN) غير مهيأ في الخادم حالياً. يرجى التواصل مع مطور النظام.');
    }

    const message = `🧪 *طلب فحص الربط التفاعلي* 🚀\n\nلقد أرسل موقعك الإلكتروني المحاسبي طلباً تفاعلياً للتأكد من جاهزية البوت لاستقبال الموافقات والتنبيهات المباشرة\\.\n\nالرجاء الضغط على أحد الأزرار أدناه لتأكيد حالة الربط:`;

    const telegramApiUrl = `https://api.telegram.org/bot${botToken}/sendMessage`;
    const replyMarkup = {
      inline_keyboard: [
        [
          { text: "موافق (قبول) ✅", callback_data: `test:accept:${testRunId}` },
          { text: "مرفوض (رفض) ❌", callback_data: `test:reject:${testRunId}` }
        ]
      ]
    };

    const response = await fetch(telegramApiUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        chat_id: chatId,
        text: message,
        parse_mode: 'MarkdownV2',
        reply_markup: replyMarkup
      })
    });

    if (!response.ok) {
      const errBody = await response.text();
      console.error('Failed to send Telegram Test message:', response.status, errBody);
      return error('تعذر إرسال طلب الفحص إلى تليجرام. يرجى التأكد من تشغيل البوت وإدخال المعرف بشكل صحيح.');
    }

    return success({
      message: 'تم إرسال رسالة فحص تفاعلية إلى حسابك في تليجرام. يرجى الضغط على زر القبول أو الرفض هناك.',
      testRunId
    }, 201);

  } catch (err) {
    return handleApiError(err);
  }
}
