import { NextRequest } from 'next/server';
import { success, error, serverError, requireAdmin, handleApiError, parseBody } from '@/lib/api-helpers';
import { getSupabase } from '@/lib/supabase-client';
import { randomInt } from 'crypto';

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
      : '8946794048:AAEoxOAsWWFSNKxpawtwcpvo2nIy0Pf6N9I';

    // ----------------------------------------------------
    // الخطوة 1: طلب تصفير البيانات وإرسال إشعار تليجرام للموافقة
    // ----------------------------------------------------
    if (body.action === 'request') {
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

      const resetSession = config.reset_session_data as any;
      if (!resetSession || resetSession.step !== 'approved_and_code_sent') {
        return error('لم يتم الموافقة على الطلب الأمني من تليجرام بعد. يرجى الضغط على موافقة في تليجرام أولاً', 400);
      }

      // التحقق من انتهاء الصلاحية (5 دقائق)
      const expiresAt = new Date(resetSession.expires_at).getTime();
      if (Date.now() > expiresAt) {
        // تصفير الجلسة التالفة
        await s.from('company_telegram_configs')
          .update({ reset_session_data: null })
          .eq('company_id', auth.companyId);
        return error('انتهت صلاحية كود المصادقة ثنائي الأبعاد (صلاحيته 5 دقائق فقط). يرجى تقديم طلب جديد.', 400);
      }

      // التحقق من مطابقة الكود
      if (resetSession.code !== body.code.trim()) {
        return error('كود المصادقة ثنائي الأبعاد (2FA) غير صحيح! يرجى إدخال الكود المستلم على تليجرام بدقة.', 400);
      }

      // 🛑 تنفيذ التطهير المالي المعزول للشركة بنجاح وتلافي التأثير على الشركات الأخرى 🛑
      const companyId = auth.companyId;

      // 1. حذف حركات الفواتير وعناصرها
      const { data: invoices } = await s.from('invoices').select('id').eq('company_id', companyId);
      const invoiceIds = (invoices || []).map(i => i.id);
      if (invoiceIds.length > 0) {
        await s.from('invoice_items').delete().in('invoice_id', invoiceIds);
      }

      // 2. حذف سندات القبض وعلاقاتها
      const { data: receipts } = await s.from('voucher_receipts').select('id').eq('company_id', companyId);
      const receiptIds = (receipts || []).map(r => r.id);
      if (receiptIds.length > 0) {
        await s.from('receipt_invoice_items').delete().in('voucher_receipt_id', receiptIds);
      }

      // 3. حذف الحركات المالية والصرف والقيود لبيانات الشركة المحددة فقط
      await s.from('cash_transactions').delete().eq('company_id', companyId);
      await s.from('voucher_disbursements').delete().eq('company_id', companyId);
      await s.from('voucher_receipts').delete().eq('company_id', companyId);
      await s.from('invoices').delete().eq('company_id', companyId);
      await s.from('purchase_invoices').delete().eq('company_id', companyId);
      await s.from('purchase_orders').delete().eq('company_id', companyId);
      await s.from('approval_requests').delete().eq('company_id', companyId);
      await s.from('telegram_test_runs').delete().eq('company_id', companyId);
      await s.from('telegram_actions_log').delete().eq('company_id', companyId);
      
      // 4. حذف القيود الدفترية معاً
      await s.from('journal_lines').delete().eq('company_id', companyId);
      await s.from('journal_entries').delete().eq('company_id', companyId);
      
      // 5. تصفير السلاسل والأرقام التسلسلية للفواتير والقيود للبدء من 1
      await s.from('journal_sequences').delete().eq('company_id', companyId);

      // تصفير الجلسة الأمنية بعد النجاح التام
      await s.from('company_telegram_configs')
        .update({ reset_session_data: null })
        .eq('company_id', companyId);

      // تسجيل الحدث أمنياً في الأرشيف
      try {
        await s.from('security_audit_log').insert({
          company_id: companyId,
          user_id: auth.userId,
          action: 'company_database_hard_reset_success',
          details: { date: new Date().toISOString() }
        });
      } catch {}

      return success({
        status: 'reset_success',
        message: '🎉 تم تصفير وإعادة تهيئة كامل البيانات المحاسبية والقيود للشركة بنجاح! يمكنك الآن البدء من الصفر بمدخلات نظيفة ومتزنة.'
      });
    }

    return error('عملية غير صالحة');
  } catch (err) {
    return handleApiError(err);
  }
}
