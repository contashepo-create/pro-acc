/** Tenant-scoped Telegram notifications and approval delivery. */
import { getSupabase } from "@/lib/supabase-client";
import { escapeTelegramHtml } from "@/lib/telegram";
import { companyMoneyParts } from "@/lib/company-money";

const sb = () => getSupabase();
interface TelegramConfig {
  company_id: string;
  chat_id: string;
  is_enabled: boolean;
  approvals_enabled: boolean;
  approval_threshold: number;
}

/**
 * Read only the Telegram fields needed by the approval/notification runtime.
 * Older installations may not have every optional notify_* preference. A
 * missing unrelated preference must not prevent an additional user from
 * recording a voucher.
 */
export async function getTelegramConfig(
  companyId: string,
): Promise<TelegramConfig | null> {
  const { data, error } = await sb()
    .from("company_telegram_configs")
    .select(
      "company_id,chat_id,is_enabled,approvals_enabled,approval_threshold",
    )
    .eq("company_id", companyId)
    .maybeSingle();
  if (error) throw error;
  return data as TelegramConfig | null;
}

export async function getAccountBalance(
  accountId: string,
  companyId?: string,
): Promise<number> {
  if (!companyId)
    throw new Error("companyId is required for a tenant-scoped balance");
  const { data, error } = await sb().rpc("get_account_balance", {
    p_company_id: companyId,
    p_account_id: accountId,
    p_journal_type: null,
    p_as_of: null,
  });
  if (error) throw error;
  return Number(data) || 0;
}

export async function checkBankBalance(
  bankSafeId: string,
  amount: number,
  companyId: string,
) {
  const { data: bankAcc } = await sb()
    .from("banks_safes")
    .select("account_id,name")
    .eq("id", bankSafeId)
    .eq("company_id", companyId)
    .maybeSingle();
  if (!bankAcc)
    return { allowed: false, balance: 0, message: "البنك/الخزينة غير موجود" };
  const currentBalance = bankAcc.account_id
    ? await getAccountBalance(String(bankAcc.account_id), companyId)
    : 0;
  const { data: companyMoney } = await sb()
    .from("companies")
    .select("currency_symbol, country_code, locale, currency_code")
    .eq("id", companyId)
    .maybeSingle();
  const money = companyMoneyParts(companyMoney as { currency_symbol?: string; country_code?: string; locale?: string; currency_code?: string } | null).symbol;
  return currentBalance < amount
    ? {
        allowed: false,
        balance: currentBalance,
        message: `الرصيد غير كافٍ. الرصيد الحالي: ${currentBalance.toFixed(2)} ${money}، المبلغ المطلوب: ${amount.toFixed(2)} ${money}`,
      }
    : { allowed: true, balance: currentBalance };
}

export async function requireApproval(
  companyId: string,
  amount: number,
  transactionType: string,
  userId: string,
  transactionId: string,
  description?: string,
): Promise<{ requiresApproval: boolean; blocked: boolean; message?: string }> {
  const config = await getTelegramConfig(companyId);
  if (
    !config?.is_enabled ||
    !config.approvals_enabled ||
    config.approval_threshold <= 0 ||
    amount <= config.approval_threshold
  ) {
    return { requiresApproval: false, blocked: false };
  }
  const { data: approval, error } = await sb().rpc(
    "create_approval_request_atomic",
    {
      p_company_id: companyId,
      p_entity_type: transactionType,
      p_entity_id: transactionId,
      p_description: description || "",
      p_requester_id: userId,
    },
  );
  if (error || !(approval as { id?: string } | null)?.id) {
    return {
      requiresApproval: true,
      blocked: true,
      message: String(
        error?.message || "تعذر إنشاء طلب الاعتماد؛ لم تُنفذ العملية",
      ),
    };
  }
  try {
    await sendApprovalNotification(
      config,
      amount,
      transactionType,
      transactionId,
      userId,
      (approval as { id: string }).id,
    );
  } catch {
    return {
      requiresApproval: true,
      blocked: true,
      message: "أُنشئ طلب الاعتماد ولكن تعذر إرسال تنبيه تيليجرام",
    };
  }
  return {
    requiresApproval: true,
    blocked: true,
    message: "تم إرسال طلب الاعتماد. العملية محظورة حتى الموافقة.",
  };
}

async function sendApprovalNotification(
  config: TelegramConfig,
  amount: number,
  transactionType: string,
  transactionId: string,
  userId: string,
  approvalId: string,
) {
  const { data: user, error } = await sb()
    .from("users")
    .select("name,email")
    .eq("id", userId)
    .eq("company_id", config.company_id)
    .eq("is_active", true)
    .maybeSingle();
  if (error || !user) throw error || new Error("Approval requester not found");
  const token = process.env.TELEGRAM_BOT_TOKEN || "";
  if (!token || !config.chat_id) throw new Error("Telegram is not configured");
  const response = await fetch(
    `https://api.telegram.org/bot${token}/sendMessage`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      signal: AbortSignal.timeout(10_000),
      body: JSON.stringify({
        chat_id: config.chat_id,
        parse_mode: "HTML",
        text: `🔔 <b>طلب اعتماد جديد</b>\n\n📋 <b>النوع:</b> ${getTransactionTypeName(transactionType)}\n💰 <b>المبلغ:</b> ${amount.toFixed(2)}\n👤 <b>المستخدم:</b> ${escapeTelegramHtml(String(user.name || user.email || ''))}\n🆔 <b>العملية:</b> ${transactionId.slice(0, 8)}…`,
        reply_markup: {
          inline_keyboard: [
            [
              {
                text: "موافق ✅",
                callback_data: `approval:approve:${approvalId}`,
              },
              {
                text: "رفض ❌",
                callback_data: `approval:reject:${approvalId}`,
              },
            ],
          ],
        },
      }),
    },
  );
  if (!response.ok)
    throw new Error(`Telegram send failed with ${response.status}`);
}

export async function sendApprovalRequestNotification(
  companyId: string,
  amount: number,
  transactionType: string,
  transactionId: string,
  requesterId: string,
  approvalId: string,
) {
  const config = await getTelegramConfig(companyId);
  if (!config?.is_enabled || !config.approvals_enabled)
    throw new Error("Telegram approvals are not enabled");
  await sendApprovalNotification(
    config,
    amount,
    transactionType,
    transactionId,
    requesterId,
    approvalId,
  );
}

/** Legacy compatibility: requester identity is deliberately ignored and resolved in the RPC. */
export async function handleApprovalResponse(
  action: "approve" | "reject",
  transactionType: string,
  transactionId: string,
  _untrustedRequesterId: string,
  approverChatId: string,
): Promise<{ success: boolean; message: string }> {
  const { data, error } = await sb().rpc(
    "respond_legacy_approval_by_telegram_atomic",
    {
      p_action: action,
      p_transaction_type: transactionType,
      p_transaction_id: transactionId,
      p_chat_id: approverChatId,
    },
  );
  return error
    ? {
        success: false,
        message: String(error.message || "تعذر معالجة الاعتماد"),
      }
    : {
        success: true,
        message:
          (data as { status?: string } | null)?.status === "approved"
            ? "تم الاعتماد بنجاح ✅"
            : "تم الرفض ❌",
      };
}

export async function sendTelegramNotification(
  companyId: string,
  message: string,
): Promise<{ success: boolean; error?: string }> {
  const config = await getTelegramConfig(companyId);
  if (!config || !config.is_enabled || !config.chat_id) {
    return { success: false, error: "إعدادات التيليجرام غير مفعلة" };
  }
  const botToken =
    process.env.TELEGRAM_BOT_TOKEN &&
    !process.env.TELEGRAM_BOT_TOKEN.startsWith("sk_")
      ? process.env.TELEGRAM_BOT_TOKEN
      : "";
  if (!botToken)
    return { success: false, error: "TELEGRAM_BOT_TOKEN غير محدد" };

  try {
    const response = await fetch(
      `https://api.telegram.org/bot${botToken}/sendMessage`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          chat_id: config.chat_id,
          text: message,
          parse_mode: "HTML",
        }),
      },
    );
    if (!response.ok) {
      const errorData = await response.text();
      console.error("Telegram API error:", errorData);
      return { success: false, error: `فشل الإرسال: ${response.status}` };
    }
    return { success: true };
  } catch (err) {
    console.error("Failed to send Telegram notification:", err);
    return { success: false, error: "خطأ في الاتصال" };
  }
}

export async function sendTransactionNotification(
  companyId: string,
  type: "receipt" | "disbursement",
  details: {
    amount: number;
    reason: string;
    bankName?: string;
    userName?: string;
    date: string;
  },
): Promise<{ notified: boolean; message?: string }> {
  const config = await getTelegramConfig(companyId);
  if (!config || !config.is_enabled) return { notified: false };
  const threshold = config.approval_threshold || 0;
  if (threshold > 0 && details.amount < threshold) return { notified: false };

  const typeLabel = type === "receipt" ? "📥 سند قبض" : "📤 سند صرف";
  const message = `
${typeLabel}

💰 <b>المبلغ:</b> ${details.amount.toFixed(2)}
📋 <b>البيان:</b> ${escapeTelegramHtml(details.reason)}
🏦 <b>البنك/الخزينة:</b> ${escapeTelegramHtml(details.bankName || "غير محدد")}
📅 <b>التاريخ:</b> ${escapeTelegramHtml(details.date)}
👤 <b>المستخدم:</b> ${escapeTelegramHtml(details.userName || "غير معروف")}
  `.trim();

  const result = await sendTelegramNotification(companyId, message);
  return {
    notified: result.success,
    message: result.success ? "تم إرسال الإشعار" : result.error,
  };
}

function getTransactionTypeName(type: string): string {
  const names: Record<string, string> = {
    voucher_disbursement: "سند صرف",
    voucher_receipt: "سند قبض",
    cash_transaction: "معاملة نقدية",
    journal_entry: "قيد يومية",
    purchase_invoice: "فاتورة شراء",
    payroll: "رواتب",
    fixed_assets: "أصل ثابت",
    inventory_transaction: "حركة مخزون",
    project_expense: "صرف مشروع",
    employee_advance: "سلفة موظف",
    subcontractor_payment: "دفع مقاول",
    client_payment: "قبض عميل",
    payment_disbursement: "دفع دائن",
  };
  return names[type] || type;
}

export interface ApprovalThresholdResult {
  requiresApproval: boolean;
  /** The policy could not be read, so the operation was held for approval. */
  configurationUnavailable?: boolean;
}

export async function checkApprovalThreshold(
  companyId: string,
  amount: number,
  _transactionType: string,
  _userId: string,
): Promise<ApprovalThresholdResult> {
  // Kept in the signature for audit context/API compatibility.
  void _transactionType;
  void _userId;
  try {
    const config = await getTelegramConfig(companyId);
    if (!config || !config.is_enabled || !config.approvals_enabled) {
      return { requiresApproval: false };
    }
    const threshold = Number(config.approval_threshold) || 0;
    return { requiresApproval: threshold > 0 && amount > threshold };
  } catch (cause) {
    // A non-admin voucher creator reaches this lookup while the sole admin can
    // bypass it. Throwing here therefore produced the misleading production
    // response "حدث خطأ في الخادم" only for additional users. Fail closed
    // instead: persist a pending voucher without posting the ledger, then let
    // an admin approve it from the approvals screen once configuration is
    // available. This preserves the financial control without losing the
    // user's transaction.
    console.error("Approval configuration lookup failed; holding transaction for approval:", cause);
    return { requiresApproval: true, configurationUnavailable: true };
  }
}
