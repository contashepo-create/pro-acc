/**
 * إعدادات وقوالب الفواتير المتوافقة مع متطلبات هيئة الزكاة والضريبة والجمارك (ZATCA)
 * والمعايير المحاسبية العالمية (IFRS / GAAP).
 */

export type InvoiceTypeSelection = 'auto' | 'standard' | 'simplified';

export interface InvoiceTemplateSettings {
  // القالب والسمة
  defaultTemplate: string;
  accentColor: string;
  colorPrint: boolean;
  
  // نوع الفاتورة الضريبية
  invoiceType: InvoiceTypeSelection; // 'auto' = تلقائي حسب بيانات العميل، 'standard' = فاتورة ضريبية (B2B)، 'simplified' = فاتورة ضريبية مبسطة (B2C)
  
  // ظهور معلومات الشركة (البائع)
  showLogo: boolean;
  showCompanyName: boolean;
  showCompanyTaxNumber: boolean;
  showCompanyCR: boolean;
  showCompanyAddress: boolean;
  showCompanyPhone: boolean;
  showCompanyEmail: boolean;
  showCompanyWebsite: boolean;
  showCompanyBankDetails: boolean;
  
  // ظهور معلومات العميل (المشتري)
  showClientName: boolean;
  showClientTaxNumber: boolean;
  showClientCR: boolean;
  showClientAddress: boolean;
  showClientPhone: boolean;
  showClientEmail: boolean;
  
  // عناصر المستند والجدول
  showProject: boolean;
  showUserName: boolean;
  showDueDate: boolean;
  showPaymentStatus: boolean;
  showItemType: boolean;
  showUnit: boolean;
  showDiscountColumn: boolean;
  showQR: boolean;
  showNotes: boolean;
  showSignatureArea: boolean;
  showJournalEntry: boolean;
  
  // نصوص التذييل والشروط
  footerText: string;
  termsAndConditions: string;
}

export const DEFAULT_INVOICE_SETTINGS: InvoiceTemplateSettings = {
  defaultTemplate: 'modern',
  accentColor: '#2563eb',
  colorPrint: true,
  
  invoiceType: 'auto',
  
  showLogo: true,
  showCompanyName: true,
  showCompanyTaxNumber: true,
  showCompanyCR: true,
  showCompanyAddress: true,
  showCompanyPhone: true,
  showCompanyEmail: true,
  showCompanyWebsite: false,
  showCompanyBankDetails: true,
  
  showClientName: true,
  showClientTaxNumber: true,
  showClientCR: true,
  showClientAddress: true,
  showClientPhone: true,
  showClientEmail: true,
  
  showProject: true,
  showUserName: true,
  showDueDate: true,
  showPaymentStatus: true,
  showItemType: false,
  showUnit: true,
  showDiscountColumn: true,
  showQR: true,
  showNotes: true,
  showSignatureArea: true,
  showJournalEntry: false,
  
  footerText: '',
  termsAndConditions: 'تُستحق هذه الفاتورة وفقاً لشروط الدفع المتفق عليها. البضاعة المباعة تخضع لسياسة الضمان.',
};

export interface InvoiceTemplateDefinition {
  id: string;
  name: string;
  nameEn: string;
  description: string;
  layout: 'modern' | 'classic' | 'compact' | 'elegant' | 'construction' | 'thermal';
  colors: {
    primary: string;
    secondary: string;
    bg: string;
    border: string;
    text: string;
  };
}

export const INVOICE_TEMPLATES: InvoiceTemplateDefinition[] = [
  {
    id: 'modern',
    name: 'عصري (Modern)',
    nameEn: 'Modern Sleek',
    description: 'تصميم تقني عصري مع بطاقات معلومات مقسمة وشريط ترويسة أنيق',
    layout: 'modern',
    colors: { primary: '#2563eb', secondary: '#3b82f6', bg: '#ffffff', border: '#e2e8f0', text: '#0f172a' },
  },
  {
    id: 'classic',
    name: 'كلاسيكي (Classic)',
    nameEn: 'Classic Corporate',
    description: 'قالب محاسبي رسمي مع إطارات واضحة وختم رسمي وشبكة جدول مزدوجة',
    layout: 'classic',
    colors: { primary: '#1e293b', secondary: '#475569', bg: '#ffffff', border: '#cbd5e1', text: '#0f172a' },
  },
  {
    id: 'compact',
    name: 'مدمج (Compact)',
    nameEn: 'Compact Single-Page',
    description: 'قالب اقتصادي عالي الكفاءة يضغط المساحات للطباعة في ورقة واحدة A4',
    layout: 'compact',
    colors: { primary: '#0d9488', secondary: '#14b8a6', bg: '#ffffff', border: '#e2e8f0', text: '#0f172a' },
  },
  {
    id: 'elegant',
    name: 'فاخر (Elegant)',
    nameEn: 'Luxury & Premium',
    description: 'قالب راقٍ مع خطوط دقيقة وزوايا ناعمة وتنسيق جذاب للعلامات التجارية',
    layout: 'elegant',
    colors: { primary: '#7c3aed', secondary: '#8b5cf6', bg: '#faf5ff', border: '#e9d5ff', text: '#1e1b4b' },
  },
  {
    id: 'construction',
    name: 'مقاولات ومشاريع (Contracting)',
    nameEn: 'Construction & BOQ',
    description: 'مخصص لشركات المقاولات مع تفاصيل المشروع، الاستقطاعات، وجدول الكميات',
    layout: 'construction',
    colors: { primary: '#b45309', secondary: '#d97706', bg: '#fffbeb', border: '#fde68a', text: '#451a03' },
  },
  {
    id: 'thermal',
    name: 'إيصال حراري (POS / 80mm)',
    nameEn: 'Thermal Receipt 80mm',
    description: 'تصميم إيصال كاشير نقطة بيع 80 مم للطباعة السريعة مع باركود و QR مدمج',
    layout: 'thermal',
    colors: { primary: '#000000', secondary: '#333333', bg: '#ffffff', border: '#000000', text: '#000000' },
  },
];

export function getTemplateConfig(id: string): InvoiceTemplateDefinition {
  return INVOICE_TEMPLATES.find(t => t.id === id) || INVOICE_TEMPLATES[0];
}

/**
 * تحديد مسمى ونوع الفاتورة وفق معايير هيئة الزكاة والضريبة والجمارك (ZATCA):
 * - الفاتورة الضريبية (Standard Tax Invoice): B2B — تُصدر للمنشآت وتتطلب الرقم الضريبي للمشتري.
 * - الفاتورة الضريبية المبسطة (Simplified Tax Invoice): B2C — تُصدر للأفراد أو المبيعات النقدية.
 */
export function resolveInvoiceTitle(
  invoice: any,
  userChoice: InvoiceTypeSelection = 'auto'
): { titleAr: string; titleEn: string; isSimplified: boolean; reason: string } {
  if (userChoice === 'standard') {
    return {
      titleAr: 'فاتورة ضريبية',
      titleEn: 'Tax Invoice',
      isSimplified: false,
      reason: 'محددة كـ فاتورة ضريبية (B2B) باختيار المستخدم',
    };
  }

  if (userChoice === 'simplified') {
    return {
      titleAr: 'فاتورة ضريبية مبسطة',
      titleEn: 'Simplified Tax Invoice',
      isSimplified: true,
      reason: 'محددة كـ فاتورة ضريبية مبسطة (B2C) باختيار المستخدم',
    };
  }

  // الوضع التلقائي (Auto):
  const hasClientTaxNumber = Boolean(invoice?.client_tax_number || invoice?.contacts?.tax_number);
  const hasClientCR = Boolean(invoice?.client_commercial_registration || invoice?.contacts?.commercial_registration);
  const isB2B = hasClientTaxNumber || hasClientCR;

  if (isB2B) {
    return {
      titleAr: 'فاتورة ضريبية',
      titleEn: 'Tax Invoice',
      isSimplified: false,
      reason: 'تم التحديد تلقائياً: فاتورة ضريبية (B2B) لوجود رقم ضريبي/سجل تجاري للعميل',
    };
  }

  return {
    titleAr: 'فاتورة ضريبية مبسطة',
    titleEn: 'Simplified Tax Invoice',
    isSimplified: true,
    reason: 'تم التحديد تلقائياً: فاتورة مبسطة (B2C) لعدم وجود رقم ضريبي للعميل',
  };
}
