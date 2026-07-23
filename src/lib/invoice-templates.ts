/**
 * إعدادات قوالب الفاتورة
 * تُحفظ في جدول settings كـ JSON
 */

export interface InvoiceTemplateSettings {
  defaultTemplate: string;
  colorPrint: boolean;
  showUserName: boolean;
  showLogo: boolean;
  showClientTaxNumber: boolean;
  showClientAddress: boolean;
  showClientPhone: boolean;
  showProject: boolean;
  showNotes: boolean;
  showQR: boolean;
  showJournalEntry: boolean;
  footerText: string;
  accentColor: string;
}

export const DEFAULT_INVOICE_SETTINGS: InvoiceTemplateSettings = {
  defaultTemplate: 'modern',
  colorPrint: true,
  showUserName: true,
  showLogo: true,
  showClientTaxNumber: true,
  showClientAddress: true,
  showClientPhone: true,
  showProject: true,
  showNotes: true,
  showQR: true,
  showJournalEntry: true,
  footerText: '',
  accentColor: '#2563eb',
};

export const INVOICE_TEMPLATES = [
  {
    id: 'modern',
    name: 'عصري',
    description: 'هيدر أفقي مع شريط جانبي للألوان',
    layout: 'horizontal-header',
    colors: { primary: '#2563eb', bg: '#f0f4ff', border: '#dbeafe', header: '#2563eb' },
  },
  {
    id: 'classic',
    name: 'كلاسيكي',
    description: 'هيدر علوي مع إطار كلاسيكي',
    layout: 'top-banner',
    colors: { primary: '#1e293b', bg: '#f8fafc', border: '#cbd5e1', header: '#1e293b' },
  },
  {
    id: 'compact',
    name: 'مدمج',
    description: 'تصميم مضغوط بدون هيدر كبير',
    layout: 'compact',
    colors: { primary: '#059669', bg: '#ffffff', border: '#e2e8f0', header: '#f0fdf4' },
  },
  {
    id: 'elegant',
    name: 'أنيق',
    description: 'تصميم أنيق مع زوايا دائرية كبيرة',
    layout: 'elegant',
    colors: { primary: '#7c3aed', bg: '#faf5ff', border: '#e9d5ff', header: '#7c3aed' },
  },
  {
    id: 'corporate',
    name: 'مؤسسي',
    description: 'تصميم مؤسسي مع شريط جانبي معلومات',
    layout: 'sidebar',
    colors: { primary: '#0f766e', bg: '#f0fdfa', border: '#99f6e4', header: '#0f766e' },
  },
];

export function getTemplateConfig(id: string) {
  return INVOICE_TEMPLATES.find(t => t.id === id) || INVOICE_TEMPLATES[0];
}
