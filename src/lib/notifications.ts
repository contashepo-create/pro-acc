/**
 * نظام التنبيهات والتحقق من الرصيد
 * 
 * يوفر:
 * 1. إرسال تنبيهات بوت عند تجاوز حد الموافقة
 * 2. التحقق من رصيد البنك قبل إجراء المعاملات
 */

import { getSupabase } from '@/lib/supabase-client';

const sb = () => getSupabase();

interface TelegramConfig {
  company_id: string;
  chat_id: string;
  is_enabled: boolean;
  notify_invoices: boolean;
  notify_cash_transactions: boolean;
  notify_user_logins: boolean;
  approvals_enabled: boolean;
  approval_threshold: number;
}

/**
 * جلب إعدادات التيليجرام للشركة
 */
export async function getTelegramConfig(companyId: string): Promise<TelegramConfig | null> {
  const s = sb();
  
  const { data: config } = await s.from('company_telegram_configs')
    .select('*')
    .eq('company_id', companyId)
    .maybeSingle();
  
  return config as TelegramConfig | null;
}

/**
 * حساب رصيد حساب معين من القيود المحاسبية
 */
export async function getAccountBalance(accountId: string, companyId: string): Promise<number> {
  const s = sb();
  
  const { data: lines } = await s.from('journal_lines')
    .select('debit, credit')
    .eq('account_id', accountId)
    .eq('company_id', companyId);
  
  if (!lines || lines.length === 0) {
    return 0;
  }
  
  const totalDebit = lines.reduce((sum, l) => sum + (parseFloat(l.debit as any) || 0), 0);
  const totalCredit = lines.reduce((sum, l) => sum + (parseFloat(l.credit as any) || 0), 0);
  
  return totalDebit - totalCredit;
}

/**
 * التحقق من رصيد البنك/الخزينة
 * يُرجع: { allowed: boolean, balance: number, message?: string }
 */
export async function checkBankBalance(
  bankSafeId: string,
  amount: number,
  companyId: string
): Promise<{ allowed: boolean; balance: number; message?: string }> {
  const s = sb();
  
  // جلب الحساب المرتبط بالبنك/الخزينة
  const { data: bankAcc } = await s.from('banks_safes')
    .select('account_id, name, opening_balance')
    .eq('id', bankSafeId)
    .eq('company_id', companyId)
    .maybeSingle();
  
  if (!bankAcc) {
    return {
      allowed: false,
      balance: 0,
      message: 'البنك/الخزينة غير موجود',
    };
  }
  
  // حساب الرصيد الحالي
  let currentBalance = 0;
  
  if (bankAcc.account_id) {
    currentBalance = await getAccountBalance(bankAcc.account_id, companyId);
  } else {
    // إذا لم يكن هناك حساب، استخدم الرصيد الافتتاحي
    currentBalance = parseFloat(bankAcc.opening_balance as any) || 0;
  }
  
  // التحقق من أن الرصيد كافٍ
  if (currentBalance < amount) {
    return {
      allowed: false,
      balance: currentBalance,
      message: `الرصيد غير كافٍ. الرصيد الحالي: ${currentBalance.toFixed(2)} ر.س، المبلغ المطلوب: ${amount.toFixed(2)} ر.س`,
    };
  }
  
  return {
    allowed: true,
    balance: currentBalance,
  };
}

/**
 * التحقق من حد الموافقة وإرسال تنبيه إذا لزم الأمر
 * يُرجع: { requiresApproval: boolean, message?: string }
 */
export async function checkApprovalThreshold(
  companyId: string,
  amount: number,
  transactionType: string,
  userId: string
): Promise<{ requiresApproval: boolean; message?: string }> {
  const config = await getTelegramConfig(companyId);
  
  if (!config || !config.is_enabled || !config.approvals_enabled) {
    return { requiresApproval: false };
  }
  
  const threshold = config.approval_threshold || 0;
  
  if (threshold > 0 && amount > threshold) {
    // إرسال تنبيه بوت
    try {
      await sendApprovalNotification(config, amount, transactionType, userId);
      
      return {
        requiresApproval: true,
        message: `تم إرسال تنبيه للموافقة. المبلغ (${amount.toFixed(2)} ر.س) يتجاوز حد الموافقة (${threshold.toFixed(2)} ر.س)`,
      };
    } catch (err) {
      console.error('Failed to send approval notification:', err);
      return {
        requiresApproval: true,
        message: `المبلغ يتجاوز حد الموافقة لكن فشل إرسال التنبيه`,
      };
    }
  }
  
  return { requiresApproval: false };
}

/**
 * إرسال تنبيه الموافقة عبر بوت التيليجرام
 */
async function sendApprovalNotification(
  config: TelegramConfig,
  amount: number,
  transactionType: string,
  userId: string
): Promise<void> {
  const s = sb();
  
  // جلب معلومات المستخدم
  const { data: user } = await s.from('users')
    .select('name, email')
    .eq('id', userId)
    .maybeSingle();
  
  const userName = (user as any)?.name || 'مستخدم غير معروف';
  const userEmail = (user as any)?.email || '';
  
  const typeNames: Record<string, string> = {
    'voucher_disbursement': 'سند صرف',
    'voucher_receipt': 'سند قبض',
    'cash_transaction': 'معاملة نقدية',
    'invoice': 'فاتورة',
    'purchase_invoice': 'فاتورة شراء',
  };
  
  const typeName = typeNames[transactionType] || transactionType;
  
  const message = `
🔔 <b>تنبيه موافقة Required</b>

📋 <b>نوع المعاملة:</b> ${typeName}
💰 <b>المبلغ:</b> ${amount.toFixed(2)} ر.س
👤 <b>المستخدم:</b> ${userName}
📧 <b>البريد:</b> ${userEmail}

⚠️ المبلغ يتجاوز حد الموافقة المحدد (${config.approval_threshold.toFixed(2)} ر.س)

يرجى مراجعة المعاملة والموافقة عليها إذا كانت صحيحة.
  `.trim();
  
  // إرسال عبر تيليجرام
  const botToken = process.env.TELEGRAM_BOT_TOKEN;
  if (!botToken || !config.chat_id) {
    throw new Error('Telegram bot not configured');
  }
  
  const response = await fetch(`https://api.telegram.org/bot${botToken}/sendMessage`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      chat_id: config.chat_id,
      text: message,
      parse_mode: 'HTML',
    }),
  });
  
  if (!response.ok) {
    throw new Error('Failed to send Telegram message');
  }
}

/**
 * إرسال تنبيه عام عبر بوت التيليجرام
 */
export async function sendTelegramNotification(
  companyId: string,
  message: string
): Promise<void> {
  const config = await getTelegramConfig(companyId);
  
  if (!config || !config.is_enabled || !config.chat_id) {
    return;
  }
  
  const botToken = process.env.TELEGRAM_BOT_TOKEN;
  if (!botToken) {
    return;
  }
  
  try {
    await fetch(`https://api.telegram.org/bot${botToken}/sendMessage`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        chat_id: config.chat_id,
        text: message,
        parse_mode: 'HTML',
      }),
    });
  } catch (err) {
    console.error('Failed to send Telegram notification:', err);
  }
}
