/**
 * Internationalization (i18n) System
 * Supports Arabic (ar) and English (en)
 * 
 * Usage:
 *   import { t } from '@/lib/i18n';
 *   const label = t('common.save', 'ar');
 */

export type Locale = 'ar' | 'en';

type TranslationKeys = typeof translations.ar;

export const translations = {
  ar: {
    // Common
    'common.save': 'حفظ',
    'common.cancel': 'إلغاء',
    'common.delete': 'حذف',
    'common.edit': 'تعديل',
    'common.add': 'إضافة',
    'common.search': 'بحث',
    'common.filter': 'تصفية',
    'common.export': 'تصدير',
    'common.import': 'استيراد',
    'common.print': 'طباعة',
    'common.refresh': 'تحديث',
    'common.loading': 'جارٍ التحميل...',
    'common.noData': 'لا توجد بيانات',
    'common.confirm': 'تأكيد',
    'common.back': 'رجوع',
    'common.next': 'التالي',
    'common.yes': 'نعم',
    'common.no': 'لا',
    'common.success': 'تم بنجاح',
    'common.error': 'حدث خطأ',
    'common.required': 'مطلوب',
    'common.optional': 'اختياري',
    'common.active': 'نشط',
    'common.inactive': 'مُعطّل',
    'common.total': 'الإجمالي',
    'common.date': 'التاريخ',
    'common.amount': 'المبلغ',
    'common.description': 'الوصف',
    'common.status': 'الحالة',
    'common.actions': 'الإجراءات',
    'common.name': 'الاسم',
    'common.email': 'البريد الإلكتروني',
    'common.phone': 'الهاتف',
    'common.address': 'العنوان',
    'common.notes': 'ملاحظات',
    'common.type': 'النوع',
    'common.code': 'الرمز',
    'common.number': 'الرقم',
    'common.reference': 'المرجع',

    // Currency
    'currency.sar': 'ريال سعودي',
    'currency.aed': 'درهم إماراتي',
    'currency.kwd': 'دينار كويتي',
    'currency.bhd': 'دينار بحريني',
    'currency.omr': 'ريال عماني',
    'currency.qar': 'ريال قطري',

    // Auth
    'auth.login': 'تسجيل الدخول',
    'auth.logout': 'تسجيل الخروج',
    'auth.register': 'إنشاء حساب',
    'auth.forgotPassword': 'نسيت كلمة المرور',
    'auth.resetPassword': 'إعادة تعيين كلمة المرور',
    'auth.email': 'البريد الإلكتروني',
    'auth.password': 'كلمة المرور',
    'auth.confirmPassword': 'تأكيد كلمة المرور',

    // Dashboard
    'dashboard.title': 'لوحة التحكم',
    'dashboard.revenue': 'الإيرادات',
    'dashboard.expenses': 'المصروفات',
    'dashboard.profit': 'صافي الربح',
    'dashboard.loss': 'صافي الخسارة',

    // Accounts
    'accounts.title': 'دليل الحسابات',
    'accounts.addAccount': 'إضافة حساب',
    'accounts.asset': 'أصول',
    'accounts.liability': 'خصوم',
    'accounts.equity': 'حقوق الملكية',
    'accounts.revenue': 'إيرادات',
    'accounts.expense': 'مصروفات',

    // Journal
    'journal.title': 'القيود اليومية',
    'journal.newEntry': 'قيد جديد',
    'journal.debit': 'مدين',
    'journal.credit': 'دائن',
    'journal.balance': 'الموازنة',
    'journal.unbalanced': 'القيد غير متوازن',

    // Invoices
    'invoices.title': 'الفواتير',
    'invoices.newInvoice': 'فاتورة جديدة',
    'invoices.unpaid': 'غير مدفوعة',
    'invoices.partial': 'مدفوعة جزئياً',
    'invoices.paid': 'مدفوعة',
    'invoices.overdue': 'متأخرة',
    'invoices.subtotal': 'المجموع قبل الضريبة',
    'invoices.vat': 'ضريبة القيمة المضافة',
    'invoices.grandTotal': 'الإجمالي',

    // Vouchers
    'vouchers.receipt': 'سند قبض',
    'vouchers.disbursement': 'سند صرف',
    'vouchers.receipts': 'سندات القبض',
    'vouchers.disbursements': 'سندات الصرف',

    // Cash
    'cash.title': 'سندات الصندوق',
    'cash.cashReceipt': 'قبض صندوق',
    'cash.cashPayment': 'صرف صندوق',

    // Contacts
    'contacts.title': 'العملاء والموردين',
    'contacts.clients': 'العملاء',
    'contacts.suppliers': 'الموردين',
    'contacts.addClient': 'إضافة عميل',
    'contacts.addSupplier': 'إضافة مورد',

    // Projects
    'projects.title': 'المشاريع',
    'projects.newProject': 'مشروع جديد',
    'projects.active': 'نشط',
    'projects.completed': 'مكتمل',
    'projects.onHold': 'مُعلّق',
    'projects.budget': 'الميزانية',
    'projects.actualCost': 'التكلفة الفعلية',

    // Reports
    'reports.title': 'التقارير',
    'reports.trialBalance': 'ميزان المراجعة',
    'reports.incomeStatement': 'قائمة الدخل',
    'reports.balanceSheet': 'الميزانية العمومية',
    'reports.generalLedger': 'دفتر الأستاذ العام',
    'reports.agingReport': 'تقرير الأعمار',

    // Settings
    'settings.title': 'الإعدادات',
    'settings.companyInfo': 'معلومات الشركة',
    'settings.companyName': 'اسم الشركة',
    'settings.taxNumber': 'الرقم الضريبي',
    'settings.commercialReg': 'السجل التجاري',

    // Users
    'users.title': 'إدارة المستخدمين',
    'users.addUser': 'إضافة مستخدم',
    'users.role': 'الدور',
    'users.admin': 'مدير النظام',
    'users.manager': 'مدير',
    'users.accountant': 'محاسب',
    'users.supervisor': 'مشرف',

    // ZATCA
    'zatca.qrCode': 'رمز الاستجابة السريعة',
    'zatca.taxInvoice': 'فاتورة ضريبية',
    'zatca.simplifiedInvoice': 'فاتورة مبسطة',

    // Errors
    'error.unauthorized': 'غير مصرح به',
    'error.notFound': 'غير موجود',
    'error.forbidden': 'ليس لديك صلاحية',
    'error.validation': 'بيانات غير صحيحة',
    'error.server': 'خطأ في الخادم',
  },

  en: {
    // Common
    'common.save': 'Save',
    'common.cancel': 'Cancel',
    'common.delete': 'Delete',
    'common.edit': 'Edit',
    'common.add': 'Add',
    'common.search': 'Search',
    'common.filter': 'Filter',
    'common.export': 'Export',
    'common.import': 'Import',
    'common.print': 'Print',
    'common.refresh': 'Refresh',
    'common.loading': 'Loading...',
    'common.noData': 'No data available',
    'common.confirm': 'Confirm',
    'common.back': 'Back',
    'common.next': 'Next',
    'common.yes': 'Yes',
    'common.no': 'No',
    'common.success': 'Success',
    'common.error': 'An error occurred',
    'common.required': 'Required',
    'common.optional': 'Optional',
    'common.active': 'Active',
    'common.inactive': 'Inactive',
    'common.total': 'Total',
    'common.date': 'Date',
    'common.amount': 'Amount',
    'common.description': 'Description',
    'common.status': 'Status',
    'common.actions': 'Actions',
    'common.name': 'Name',
    'common.email': 'Email',
    'common.phone': 'Phone',
    'common.address': 'Address',
    'common.notes': 'Notes',
    'common.type': 'Type',
    'common.code': 'Code',
    'common.number': 'Number',
    'common.reference': 'Reference',

    // Currency
    'currency.sar': 'Saudi Riyal',
    'currency.aed': 'UAE Dirham',
    'currency.kwd': 'Kuwaiti Dinar',
    'currency.bhd': 'Bahraini Dinar',
    'currency.omr': 'Omani Rial',
    'currency.qar': 'Qatari Riyal',

    // Auth
    'auth.login': 'Login',
    'auth.logout': 'Logout',
    'auth.register': 'Register',
    'auth.forgotPassword': 'Forgot Password',
    'auth.resetPassword': 'Reset Password',
    'auth.email': 'Email',
    'auth.password': 'Password',
    'auth.confirmPassword': 'Confirm Password',

    // Dashboard
    'dashboard.title': 'Dashboard',
    'dashboard.revenue': 'Revenue',
    'dashboard.expenses': 'Expenses',
    'dashboard.profit': 'Net Profit',
    'dashboard.loss': 'Net Loss',

    // Accounts
    'accounts.title': 'Chart of Accounts',
    'accounts.addAccount': 'Add Account',
    'accounts.asset': 'Assets',
    'accounts.liability': 'Liabilities',
    'accounts.equity': 'Equity',
    'accounts.revenue': 'Revenue',
    'accounts.expense': 'Expenses',

    // Journal
    'journal.title': 'Journal Entries',
    'journal.newEntry': 'New Entry',
    'journal.debit': 'Debit',
    'journal.credit': 'Credit',
    'journal.balance': 'Balance',
    'journal.unbalanced': 'Entry is unbalanced',

    // Invoices
    'invoices.title': 'Invoices',
    'invoices.newInvoice': 'New Invoice',
    'invoices.unpaid': 'Unpaid',
    'invoices.partial': 'Partially Paid',
    'invoices.paid': 'Paid',
    'invoices.overdue': 'Overdue',
    'invoices.subtotal': 'Subtotal',
    'invoices.vat': 'VAT',
    'invoices.grandTotal': 'Grand Total',

    // Vouchers
    'vouchers.receipt': 'Receipt Voucher',
    'vouchers.disbursement': 'Disbursement Voucher',
    'vouchers.receipts': 'Receipt Vouchers',
    'vouchers.disbursements': 'Disbursement Vouchers',

    // Cash
    'cash.title': 'Cash Vouchers',
    'cash.cashReceipt': 'Cash Receipt',
    'cash.cashPayment': 'Cash Payment',

    // Contacts
    'contacts.title': 'Clients & Suppliers',
    'contacts.clients': 'Clients',
    'contacts.suppliers': 'Suppliers',
    'contacts.addClient': 'Add Client',
    'contacts.addSupplier': 'Add Supplier',

    // Projects
    'projects.title': 'Projects',
    'projects.newProject': 'New Project',
    'projects.active': 'Active',
    'projects.completed': 'Completed',
    'projects.onHold': 'On Hold',
    'projects.budget': 'Budget',
    'projects.actualCost': 'Actual Cost',

    // Reports
    'reports.title': 'Reports',
    'reports.trialBalance': 'Trial Balance',
    'reports.incomeStatement': 'Income Statement',
    'reports.balanceSheet': 'Balance Sheet',
    'reports.generalLedger': 'General Ledger',
    'reports.agingReport': 'Aging Report',

    // Settings
    'settings.title': 'Settings',
    'settings.companyInfo': 'Company Information',
    'settings.companyName': 'Company Name',
    'settings.taxNumber': 'Tax Number (VAT)',
    'settings.commercialReg': 'Commercial Registration',

    // Users
    'users.title': 'User Management',
    'users.addUser': 'Add User',
    'users.role': 'Role',
    'users.admin': 'System Admin',
    'users.manager': 'Manager',
    'users.accountant': 'Accountant',
    'users.supervisor': 'Supervisor',

    // ZATCA
    'zatca.qrCode': 'QR Code',
    'zatca.taxInvoice': 'Tax Invoice',
    'zatca.simplifiedInvoice': 'Simplified Invoice',

    // Errors
    'error.unauthorized': 'Unauthorized',
    'error.notFound': 'Not Found',
    'error.forbidden': 'Forbidden',
    'error.validation': 'Validation Error',
    'error.server': 'Server Error',
  },
};

/**
 * Get translation for a key
 */
export function t(key: keyof TranslationKeys['ar'] | string, locale: Locale = 'ar'): string {
  const dict = translations[locale] || translations.ar;
  return (dict as Record<string, string>)[key] || (translations.ar as Record<string, string>)[key] || key;
}

/**
 * Get the direction for a locale
 */
export function getDirection(locale: Locale): 'rtl' | 'ltr' {
  return locale === 'ar' ? 'rtl' : 'ltr';
}

/**
 * Format currency based on locale
 */
export function formatCurrency(amount: number, locale: Locale = 'ar', currency = 'SAR'): string {
  return new Intl.NumberFormat(locale === 'ar' ? 'ar-SA' : 'en-US', {
    style: 'currency',
    currency,
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  }).format(amount);
}

/**
 * Format date based on locale
 */
export function formatDate(date: string | Date, locale: Locale = 'ar'): string {
  const d = typeof date === 'string' ? new Date(date) : date;
  return d.toLocaleDateString(locale === 'ar' ? 'ar-SA' : 'en-US', {
    year: 'numeric',
    month: 'long',
    day: 'numeric',
  });
}

/**
 * Format number based on locale
 */
export function formatNumber(num: number, locale: Locale = 'ar'): string {
  return new Intl.NumberFormat(locale === 'ar' ? 'ar-SA' : 'en-US').format(num);
}
