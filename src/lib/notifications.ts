/**
 * نظام التنبيهات والتحقق من الرصيد (محسّن)
 * 
 * يوفر:
 * 1. إرسال تنبيهات بوت مع أزرار الموافقة/الرفض
 * 2. التحقق من رصيد البنك قبل إجراء المعاملات
 * 3. معالجة الردود عبر webhook
 * 4. حماية العمليات المعلقة من التنفيذ
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

export async function getTelegramConfig(companyId: string): Promise<TelegramConfig | null> {
  const s = sb();
  const { data: config } = await s.from('company_telegram_configs')
    .select('*')
    .eq('company_id', companyId)
    .maybeSingle();
  return config as TelegramConfig | null;
}

export async function getAccountBalance(accountId: string, companyId?: string): Promise<number> {
  const s = sb();
  let query = s.from('journal_lines')
    .select('debit, credit')
    .eq('account_id', accountId);
  if (companyId) query = query.eq('company_id', companyId);
  const { data: lines } = await query;
  if (!lines || lines.length === 0) return 0;
  const totalDebit = lines.reduce((sum, l) => sum + (parseFloat(l.debit as any) || 0), 0);
  const totalCredit = lines.reduce((sum, l) => sum + (parseFloat(l.credit as any) || 0), 0);
  return totalDebit - totalCredit;
}

export async function checkBankBalance(
  bankSafeId: string,
  amount: number,
  companyId: string
): Promise<{ allowed: boolean; balance: number; message?: string }> {
  const s = sb();
  const { data: bankAcc } = await s.from('banks_safes')
    .select('account_id, name')
    .eq('id', bankSafeId)
    .eq('company_id', companyId)
    .maybeSingle();
  if (!bankAcc) return { allowed: false, balance: 0, message: 'البنك/الخزينة غير موجود' };
  let currentBalance = 0;
  if (bankAcc.account_id) currentBalance = await getAccountBalance(bankAcc.account_id);
  if (currentBalance < amount) {
    return {
      allowed: false,
      balance: currentBalance,
      message: `الرصيد غير كافٍ. الرصيد الحالي: ${currentBalance.toFixed(2)} ر.س، المبلغ المطلوب: ${amount.toFixed(2)} ر.س`,
    };
  }
  return { allowed: true, balance: currentBalance };
}

/**
 * التحقق من حد الموافقة وإنشاء طلب اعتماد
 * هذه الدالة تحفظ العملية بحالة "pending" وتطلب الاعتماد عبر التيليغرام
 */
export async function requireApproval(
  companyId: string,
  amount: number,
  transactionType: string,
  userId: string,
  transactionId: string,
  description?: string
): Promise<{ requiresApproval: boolean; blocked: boolean; message?: string }> {
  const config = await getTelegramConfig(companyId);
  
  // إذا لم يكن التيليجرام مفعلاً أو الاعتمادات غير مفعلة، لا نحتاج لاعتماد
  if (!config || !config.is_enabled || !config.approvals_enabled) {
    return { requiresApproval: false, blocked: false };
  }
  
  const threshold = config.approval_threshold || 0;
  
  // إذا كان المبلغ تحت الحد، لا نحتاج لاعتماد
  if (threshold <= 0 || amount <= threshold) {
    return { requiresApproval: false, blocked: false };
  }
  
  // نحتاج لاعتماد - نحفظ العملية كـ pending ونرسل تنبيه
  const s = sb();
  
  try {
    // 1. إنشاء طلب اعتماد في قاعدة البيانات
    const { data: approvalReq, error: insertErr } = await s.from('approval_requests')
      .insert({
        company_id: companyId,
        transaction_type: transactionType,
        transaction_id: transactionId,
        amount: amount,
        requester_id: userId,
        status: 'pending',
        message: description || `طلب اعتماد ${getTransactionTypeName(transactionType)}`,
        created_at: new Date().toISOString(),
      })
      .select()
      .single();
    
    if (insertErr) throw insertErr;
    
    const approvalId = (approvalReq as any).id;
    
    // 2. تحديث حالة العملية الأصلية إلى pending
    await updateTransactionStatus(companyId, transactionType, transactionId, 'pending', approvalId);
    
    // 3. إرسال رسالة التيليغرام
    await sendApprovalNotification(config, amount, transactionType, transactionId, userId, approvalId);
    
    return {
      requiresApproval: true,
      blocked: true, // العملية محظورة حتى الاعتماد
      message: `تم إرسال طلب الاعتماد. العملية محظورة حتى الموافقة.`
    };
    
  } catch (err) {
    console.error('Failed to create approval request:', err);
    return {
      requiresApproval: true,
      blocked: false, // في حالة الخطأ، نسمح بالعملية لتجنب توقف النظام
      message: 'فشل إنشاء طلب الاعتماد، تم السماح بالعملية'
    };
  }
}

/**
 * تحديث حالة العملية (دالة مساعدة)
 */
async function updateTransactionStatus(
  companyId: string,
  transactionType: string,
  transactionId: string,
  status: string,
  approvalId?: string
): Promise<void> {
  const s = sb();
  const tableMap: Record<string, string> = {
    'voucher_disbursement': 'voucher_disbursements',
    'voucher_receipt': 'voucher_receipts',
    'cash_transaction': 'cash_transactions',
    'journal_entry': 'journal_entries',
    'purchase_invoice': 'purchase_invoices',
  };
  
  const tableName = tableMap[transactionType];
  if (!tableName) return;
  
  const updateData: any = { status };
  if (approvalId) updateData.approval_request_id = approvalId;
  
  await s.from(tableName)
    .update(updateData)
    .eq('id', transactionId)
    .eq('company_id', companyId);
}

/**
 * إرسال رسالة الموافقة عبر التيليغرام
 */
async function sendApprovalNotification(
  config: TelegramConfig,
  amount: number,
  transactionType: string,
  transactionId: string,
  userId: string,
  approvalId: string
): Promise<void> {
  const s = sb();
  
  const { data: user } = await s.from('users')
    .select('name, email')
    .eq('id', userId)
    .maybeSingle();
  
  const userName = (user as any)?.name || 'مستخدم غير معروف';
  const userEmail = (user as any)?.email || '';
  
  const message = `
🔔 <b>طلب اعتماد جديد</b>

📋 <b>النوع:</b> ${getTransactionTypeName(transactionType)}
💰 <b>المبلغ:</b> ${amount.toFixed(2)} ر.س
👤 <b>المستخدم:</b> ${userName}
📧 <b>البريد:</b> ${userEmail}
🆔 <b>رقم العملية:</b> ${transactionId.slice(0, 8)}...

⚠️ يتجاوز حد الموافقة (${config.approval_threshold.toFixed(2)} ر.س)

يرجى الموافقة أو الرفض:
  `.trim();
  
  const inlineKeyboard = {
    inline_keyboard: [
      [
        {
          text: '✅ موافق',
          callback_data: `approve_approve_${transactionType}_${transactionId}_${userId}`
        },
        {
          text: '❌ رافض',
          callback_data: `approve_reject_${transactionType}_${transactionId}_${userId}`
        }
      ]
    ]
  };
  
  const botToken = process.env.TELEGRAM_BOT_TOKEN && !process.env.TELEGRAM_BOT_TOKEN.startsWith('sk_') 
    ? process.env.TELEGRAM_BOT_TOKEN 
    : '8946794048:AAEoxOAsWWFSNKxpawtwcpvo2nIy0Pf6N9I';
  
  if (!botToken || !config.chat_id) {
    console.warn('Telegram bot not configured or chat_id missing');
    return;
  }
  
  const response = await fetch(`https://api.telegram.org/bot${botToken}/sendMessage`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      chat_id: config.chat_id,
      text: message,
      parse_mode: 'HTML',
      reply_markup: inlineKeyboard,
    }),
  });
  
  if (!response.ok) {
    const errorText = await response.text();
    console.error('Failed to send Telegram approval notification:', response.status, errorText);
    throw new Error('Failed to send Telegram message');
  }
}

/**
 * معالجة الرد على طلب الموافقة (من webhook)
 */
export async function handleApprovalResponse(
  action: 'approve' | 'reject',
  transactionType: string,
  transactionId: string,
  userId: string,
  approverChatId: string
): Promise<{ success: boolean; message: string }> {
  const s = sb();
  
  // جلب طلب الاعتماد
  const { data: approvalReq, error: findErr } = await s.from('approval_requests')
    .select('id, company_id, status')
    .eq('transaction_id', transactionId)
    .eq('transaction_type', transactionType)
    .eq('status', 'pending')
    .maybeSingle();
  
  if (findErr || !approvalReq) {
    return { success: false, message: 'طلب الاعتماد غير موجود أو تمت معالجته بالفعل' };
  }
  
  const companyId = (approvalReq as any).company_id;
  const approvalId = (approvalReq as any).id;
  
  // SECURITY FIX: التحقق الصارم من أن معرّف المحادثة للموافق يتطابق تماماً مع المعرّف المسجل والمعتمد للشركة!
  // يمنع هذا أي مستخدم تيليجرام غريب يعرف البوت من محاولة تخمين أو النقر والموافقة على العمليات المالية للشركات
  const { data: config } = await s.from('company_telegram_configs')
    .select('chat_id, approvals_enabled')
    .eq('company_id', companyId)
    .maybeSingle();

  if (!config || !config.approvals_enabled || config.chat_id !== String(approverChatId)) {
    return { success: false, message: '❌ عذراً، هذا الحساب في تيليجرام غير مصرح له باعتماد هذه المعاملة مالياً' };
  }
  
  const newStatus = action === 'approve' ? 'approved' : 'rejected';
  const now = new Date().toISOString();
  
  // تحديث حالة طلب الاعتماد
  const { error: updateErr } = await s.from('approval_requests')
    .update({
      status: newStatus,
      approver_chat_id: String(approverChatId),
      approved_at: now,
    })
    .eq('id', approvalId);
  
  if (updateErr) {
    console.error('Failed to update approval request:', updateErr);
    return { success: false, message: 'فشل تحديث حالة الاعتماد' };
  }
  
  // تحديث حالة العملية الأصلية
  const finalStatus = action === 'approve' ? 'approved' : 'rejected';
  await updateTransactionStatus(companyId, transactionType, transactionId, finalStatus, approvalId);
  
  // FIXED: توليد الترحيل المالي والقيود تلقائياً فور اعتماد طلب تيليجرام
  if (action === 'approve') {
    try {
      const { createJournalEntryForApprovedTransaction } = await import('@/lib/approval-helpers');
      await createJournalEntryForApprovedTransaction(companyId, userId, transactionType, transactionId);
    } catch (createErr) {
      console.error('Failed to create journal entry on approval:', createErr);
    }
  }
  
  // إرسال إشعار للمستخدم الطالب
  try {
    await s.from('notifications').insert({
      id: crypto.randomUUID(),
      company_id: companyId,
      user_id: userId,
      type: action === 'approve' ? 'approval_approved' : 'approval_rejected',
      title: action === 'approve' ? 'تم اعتماد طلبك' : 'تم رفض طلبك',
      message: `${getTransactionTypeName(transactionType)} - ${action === 'approve' ? 'تم الاعتماد بنجاح' : 'تم الرفض'}`,
      entity_type: 'approval_request',
      entity_id: approvalId,
      created_at: now,
    });
  } catch (notifErr) {
    console.warn('Failed to send notification:', notifErr);
  }
  
  const successMessage = action === 'approve'
    ? `✅ تم الموافقة على ${getTransactionTypeName(transactionType)} بنجاح!`
    : `❌ تم رفض ${getTransactionTypeName(transactionType)}.`;
  
  return { success: true, message: successMessage };
}

export async function sendTelegramNotification(
  companyId: string,
  message: string
): Promise<{ success: boolean; error?: string }> {
  const config = await getTelegramConfig(companyId);
  if (!config || !config.is_enabled || !config.chat_id) {
    return { success: false, error: 'إعدادات التيليجرام غير مفعلة' };
  }
  const botToken = process.env.TELEGRAM_BOT_TOKEN && !process.env.TELEGRAM_BOT_TOKEN.startsWith('sk_') 
    ? process.env.TELEGRAM_BOT_TOKEN 
    : '8946794048:AAEoxOAsWWFSNKxpawtwcpvo2nIy0Pf6N9I';
  if (!botToken) return { success: false, error: 'TELEGRAM_BOT_TOKEN غير محدد' };
  
  try {
    const response = await fetch(`https://api.telegram.org/bot${botToken}/sendMessage`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ chat_id: config.chat_id, text: message, parse_mode: 'HTML' }),
    });
    if (!response.ok) {
      const errorData = await response.text();
      console.error('Telegram API error:', errorData);
      return { success: false, error: `فشل الإرسال: ${response.status}` };
    }
    return { success: true };
  } catch (err) {
    console.error('Failed to send Telegram notification:', err);
    return { success: false, error: 'خطأ في الاتصال' };
  }
}

export async function sendTransactionNotification(
  companyId: string,
  type: 'receipt' | 'disbursement',
  details: { amount: number; reason: string; bankName?: string; userName?: string; date: string; }
): Promise<{ notified: boolean; message?: string }> {
  const config = await getTelegramConfig(companyId);
  if (!config || !config.is_enabled) return { notified: false };
  const threshold = config.approval_threshold || 0;
  if (threshold > 0 && details.amount < threshold) return { notified: false };
  
  const typeLabel = type === 'receipt' ? '📥 سند قبض' : '📤 سند صرف';
  const message = `
${typeLabel}

💰 <b>المبلغ:</b> ${details.amount.toFixed(2)} ر.س
📋 <b>البيان:</b> ${details.reason}
🏦 <b>البنك/الخزينة:</b> ${details.bankName || 'غير محدد'}
📅 <b>التاريخ:</b> ${details.date}
👤 <b>المستخدم:</b> ${details.userName || 'غير معروف'}
  `.trim();
  
  const result = await sendTelegramNotification(companyId, message);
  return {
    notified: result.success,
    message: result.success ? 'تم إرسال الإشعار' : result.error,
  };
}

function getTransactionTypeName(type: string): string {
  const names: Record<string, string> = {
    voucher_disbursement: 'سند صرف',
    voucher_receipt: 'سند قبض',
    cash_transaction: 'معاملة نقدية',
    journal_entry: 'قيد يومية',
    purchase_invoice: 'فاتورة شراء',
    payroll: 'رواتب',
    fixed_assets: 'أصل ثابت',
    inventory_transaction: 'حركة مخزون',
    project_expense: 'صرف مشروع',
    employee_advance: 'سلفة موظف',
    subcontractor_payment: 'دفع مقاول',
    client_payment: 'قبض عميل',
    payment_disbursement: 'دفع دائن',
  };
  return names[type] || type;
}

export async function checkApprovalThreshold(
  companyId: string,
  amount: number,
  transactionType: string,
  userId: string
): Promise<{ requiresApproval: boolean }> {
  const config = await getTelegramConfig(companyId);
  if (!config || !config.is_enabled || !config.approvals_enabled) {
    return { requiresApproval: false };
  }
  const threshold = config.approval_threshold || 0;
  return { requiresApproval: threshold > 0 && amount > threshold };
}