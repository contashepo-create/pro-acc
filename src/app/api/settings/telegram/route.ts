import { NextRequest } from 'next/server';
import { success, error, handleApiError, requireAdmin, parseBody } from '@/lib/api-helpers';
import { getSupabase } from '@/lib/supabase-client';
import { telegramConfigSchema } from '@/lib/communication-validation';
import { checkModuleAccess } from '@/lib/usage-limits';

const defaultConfig = {
  chat_id: '', is_enabled: false, notify_invoices: true, notify_cash_transactions: true,
  notify_user_logins: false, approvals_enabled: true, approval_threshold: 5000,
};

export async function GET(request: NextRequest) {
  try {
    const auth = await requireAdmin(request);
    const isAllowed = await checkModuleAccess(auth.companyId, 'telegram_integration');
    if (!isAllowed) return success({ isAllowed: false, config: null, message: 'ميزة تيليجرام غير متوفرة في باقتك الحالية' });
    const { data, error: queryError } = await getSupabase().from('company_telegram_configs')
      .select('chat_id,is_enabled,notify_invoices,notify_cash_transactions,notify_user_logins,approvals_enabled,approval_threshold,updated_at')
      .eq('company_id', auth.companyId).maybeSingle();
    if (queryError) throw queryError;
    return success({ isAllowed: true, config: data || defaultConfig, bot_configured: !!process.env.TELEGRAM_BOT_TOKEN });
  } catch (cause) {
    return handleApiError(cause);
  }
}

async function saveTelegramConfig(request: NextRequest) {
  try {
    const auth = await requireAdmin(request);
    if (!await checkModuleAccess(auth.companyId, 'telegram_integration')) return error('هذه الميزة غير متوفرة في باقتك الحالية', 403);
    const parsed = telegramConfigSchema.safeParse(await parseBody(request));
    if (!parsed.success) return error(parsed.error.issues[0]?.message || 'إعدادات تيليجرام غير صالحة');
    const { data, error: rpcError } = await getSupabase().rpc('save_telegram_config_atomic', {
      p_company_id: auth.companyId, p_user_id: auth.userId, p_payload: parsed.data,
    });
    if (rpcError) throw rpcError;
    return success(data);
  } catch (cause) {
    return handleApiError(cause);
  }
}

export const POST = saveTelegramConfig;
export const PUT = saveTelegramConfig;
