/**
 * دالة جلب توكن البوت الآمنة
 * لا تستخدم قيمة افتراضية أبدًا - يجب دائمًا أن يكون متغير البيئة موجودًا
 */
export function getBotToken(): string {
  const token = process.env.TELEGRAM_BOT_TOKEN?.trim();
  
  if (!token) {
    throw new Error('TELEGRAM_BOT_TOKEN is not configured in environment variables');
  }
  
  // Validate token format (should start with a number and contain colon)
  if (!token.match(/^\d+:[A-Za-z0-9_-]+$/)) {
    throw new Error('Invalid TELEGRAM_BOT_TOKEN format');
  }
  
  return token;
}

/**
 * الحصول على معرف دردشة المدير مع التحقق من الصيغة
 */
export function getAdminChatId(): string {
  const chatId = process.env.TELEGRAM_ADMIN_CHAT_ID?.trim();
  
  if (!chatId) {
    throw new Error('TELEGRAM_ADMIN_CHAT_ID is not configured');
  }
  
  // Chat ID should be numeric (positive for users, negative for groups/channels)
  if (!chatId.match(/^-?\d+$/)) {
    throw new Error('Invalid TELEGRAM_ADMIN_CHAT_ID format: must be numeric');
  }
  
  return chatId;
}