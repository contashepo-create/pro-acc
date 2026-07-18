import { NextRequest } from 'next/server';
import { success, error, serverError, requireApiAuth, handleApiError, parseBody } from '@/lib/api-helpers';
import { getSupabase } from '@/lib/supabase-client';
import { checkModuleAccess } from '@/lib/usage-limits';

const sb = () => getSupabase();

/**
 * GET /api/settings/telegram
 * جلب إعدادات بوت تيليجرام الحالية للشركة
 */
export async function GET(request: NextRequest) {
  try {
    const auth = await requireApiAuth(request);
    
    // 1. التحقق من صلاحية الميزة بناءً على خطة الاشتراك الحالية
    const isAllowed = await checkModuleAccess(auth.companyId, 'telegram_integration');
    if (!isAllowed) {
      return success({
        isAllowed: false,
        message: 'ميزة تيليجرام غير متوفرة في باقتك الحالية. يرجى الترقية لتفعيلها.',
        config: null
      });
    }

    const s = sb();
    
    // جلب الإعدادات من الجدول
    const { data: config, error: queryErr } = await s.from('company_telegram_configs')
      .select('*')
      .eq('company_id', auth.companyId)
      .maybeSingle();

    if (queryErr) throw queryErr;

    // في حال عدم وجود إعدادات سابقة، نقوم بإرجاع قيم افتراضية معيبة
    const defaultConfig = config || {
      company_id: auth.companyId,
      chat_id: '',
      is_enabled: false,
      notify_invoices: true,
      notify_cash_transactions: true,
      notify_user_logins: true,
      approvals_enabled: false,
      approval_threshold: 5000.00
    };

    return success({
      isAllowed: true,
      config: defaultConfig
    });

  } catch (err) {
    return handleApiError(err);
  }
}

/**
 * POST /api/settings/telegram
 * حفظ أو تحديث إعدادات تيليجرام للشركة
 */
export async function POST(request: NextRequest) {
  try {
    const auth = await requireApiAuth(request);
    
    // 1. التحقق من الصلاحية للباقة
    const isAllowed = await checkModuleAccess(auth.companyId, 'telegram_integration');
    if (!isAllowed) {
      return error('هذه الميزة غير متوفرة في باقتك الحالية. يرجى ترقية اشتراكك.', 403);
    }

    const body = await parseBody<any>(request);
    const s = sb();

    const configData = {
      company_id: auth.companyId,
      chat_id: body.chat_id || '',
      is_enabled: !!body.is_enabled,
      notify_invoices: !!body.notify_invoices,
      notify_cash_transactions: !!body.notify_cash_transactions,
      notify_user_logins: !!body.notify_user_logins,
      approvals_enabled: !!body.approvals_enabled,
      approval_threshold: Number(body.approval_threshold) || 0,
      updated_at: new Date().toISOString()
    };

    // حفظ أو تحديث في جدول الإعدادات
    const { data: updatedConfig, error: upsertErr } = await s.from('company_telegram_configs')
      .upsert(configData, { onConflict: 'company_id' })
      .select('*')
      .single();

    if (upsertErr) throw upsertErr;

    // تسجيل في الأرشيف الأمني
    try {
      await s.from('security_audit_log').insert({
        company_id: auth.companyId,
        user_id: auth.userId,
        action: 'telegram_config_updated',
        details: { is_enabled: configData.is_enabled, approvals_enabled: configData.approvals_enabled },
        ip_address: request.headers.get('x-forwarded-for') || 'unknown'
      });
    } catch {}

    return success({
      message: 'تم حفظ إعدادات تيليجرام بنجاح',
      config: updatedConfig
    });

  } catch (err) {
    return handleApiError(err);
  }
}
