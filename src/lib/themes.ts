export interface ThemeVariant {
  '--color-bg-primary': string;
  '--color-bg-secondary': string;
  '--color-bg-tertiary': string;
  '--color-bg-card': string;
  '--color-bg-hover': string;
  '--color-bg-elevated': string;
  '--color-text-primary': string;
  '--color-text-secondary': string;
  '--color-text-muted': string;
  '--color-text-inverse': string;
  '--color-accent': string;
  '--color-accent-hover': string;
  '--color-border': string;
  '--color-border-light': string;
  '--color-border-focus': string;
  '--color-sidebar-bg': string;
  '--color-sidebar-hover': string;
  '--color-sidebar-active': string;
  '--color-header-bg': string;
}

export interface Theme {
  id: string;
  name: string;
  nameEn: string;
  description: string;
  dark: ThemeVariant;
  light: ThemeVariant;
}

export const themes: Theme[] = [
  {
    id: 'amber',
    name: 'عنبر كلاسيك',
    nameEn: 'Warm Amber',
    description: 'الكلاسيكي الدافئ والمحسن — مزيج من درجات الكربوني والذهب الدافئ لراحة العين',
    dark: {
      '--color-bg-primary': '#09080d',
      '--color-bg-secondary': '#120f1d',
      '--color-bg-tertiary': '#1b1429',
      '--color-bg-card:': '#0f0c19',
      '--color-bg-card': '#0e0b18',
      '--color-bg-hover': '#1a142c',
      '--color-bg-elevated': '#161025',
      '--color-text-primary': '#f4f3f6',
      '--color-text-secondary': '#c4b9d0', // High contrast
      '--color-text-muted': '#9689a7', // High contrast
      '--color-text-inverse': '#09080d',
      '--color-accent': '#d97706',
      '--color-accent-hover': '#b45309',
      '--color-border': '#221a37',
      '--color-border-light': '#2c214c',
      '--color-border-focus': '#d97706',
      '--color-sidebar-bg': '#07050d',
      '--color-sidebar-hover': '#120f1d',
      '--color-sidebar-active': 'rgba(217, 119, 6, 0.12)',
      '--color-header-bg': 'rgba(9, 8, 13, 0.85)',
    },
    light: {
      '--color-bg-primary': '#faf9f6', // Clean paper off-white
      '--color-bg-secondary': '#f3f1eb',
      '--color-bg-tertiary': '#e9e5db',
      '--color-bg-card': '#ffffff',
      '--color-bg-hover': '#eae5db',
      '--color-bg-elevated': '#ffffff',
      '--color-text-primary': '#1c1917',
      '--color-text-secondary': '#57534e',
      '--color-text-muted': '#78716c',
      '--color-text-inverse': '#faf9f6',
      '--color-accent': '#b45309',
      '--color-accent-hover': '#92400e',
      '--color-border': '#e7e5e4',
      '--color-border-light': '#f5f5f4',
      '--color-border-focus': '#b45309',
      '--color-sidebar-bg': '#ffffff', // Clean white sidebar
      '--color-sidebar-hover': 'rgba(0, 0, 0, 0.04)',
      '--color-sidebar-active': 'rgba(180, 83, 9, 0.08)',
      '--color-header-bg': 'rgba(250, 249, 246, 0.85)',
    },
  },
  {
    id: 'teal',
    name: 'زمرد احترافي',
    nameEn: 'Teal Dusk',
    description: 'بارد وقوي — درجات الكربوني العميقة مع الأخضر النيلي',
    dark: {
      '--color-bg-primary': '#090c0c',
      '--color-bg-secondary': '#111817',
      '--color-bg-tertiary': '#182422',
      '--color-bg-card': '#0c1211',
      '--color-bg-hover': '#1d2c2b',
      '--color-bg-elevated': '#162220',
      '--color-text-primary': '#f0f4f3',
      '--color-text-secondary': '#b0c5c2', // High contrast
      '--color-text-muted': '#809491', // High contrast
      '--color-text-inverse': '#090c0c',
      '--color-accent': '#0d9488',
      '--color-accent-hover': '#0f766e',
      '--color-border': '#1d2c2b',
      '--color-border-light': '#243a38',
      '--color-border-focus': '#0d9488',
      '--color-sidebar-bg': '#060909',
      '--color-sidebar-hover': '#111817',
      '--color-sidebar-active': 'rgba(13, 148, 136, 0.12)',
      '--color-header-bg': 'rgba(9, 12, 12, 0.85)',
    },
    light: {
      '--color-bg-primary': '#f2f6f5',
      '--color-bg-secondary': '#e4ecea',
      '--color-bg-tertiary': '#d6e2e0',
      '--color-bg-card': '#ffffff',
      '--color-bg-hover': '#e8f0ee',
      '--color-bg-elevated': '#ffffff',
      '--color-text-primary': '#0f1716',
      '--color-text-secondary': '#40504d',
      '--color-text-muted': '#60726f',
      '--color-text-inverse': '#f2f6f5',
      '--color-accent': '#0d9488',
      '--color-accent-hover': '#0f766e',
      '--color-border': '#cbd5e1',
      '--color-border-light': '#f1f5f9',
      '--color-border-focus': '#0d9488',
      '--color-sidebar-bg': '#ffffff', // Clean white sidebar
      '--color-sidebar-hover': 'rgba(0, 0, 0, 0.04)',
      '--color-sidebar-active:': 'rgba(13, 148, 136, 0.08)',
      '--color-sidebar-active': 'rgba(13, 148, 136, 0.08)',
      '--color-header-bg': 'rgba(242, 246, 245, 0.85)',
    },
  },
  {
    id: 'sapphire',
    name: 'كربوني أزرق',
    nameEn: 'Sapphire Carbon',
    description: 'عصري غامق — كحلي عميق بلمسات الياقوت الأزرق الكريستالي',
    dark: {
      '--color-bg-primary': '#030712', // Deep graphite black
      '--color-bg-secondary': '#111827',
      '--color-bg-tertiary': '#1f2937',
      '--color-bg-card': '#0b0f19',
      '--color-bg-hover': '#1e293b',
      '--color-bg-elevated': '#111827',
      '--color-text-primary': '#f9fafb',
      '--color-text-secondary': '#c5c8da', // High contrast
      '--color-text-muted': '#8f92a8', // High contrast
      '--color-text-inverse': '#030712',
      '--color-accent': '#3b82f6',
      '--color-accent-hover': '#2563eb',
      '--color-border': '#1e293b',
      '--color-border-light': '#334155',
      '--color-border-focus': '#3b82f6',
      '--color-sidebar-bg': '#020617',
      '--color-sidebar-hover': '#111827',
      '--color-sidebar-active': 'rgba(59, 130, 246, 0.12)',
      '--color-header-bg': 'rgba(3, 7, 18, 0.85)',
    },
    light: {
      '--color-bg-primary': '#f8fafc', // Ultra-clean cool slate
      '--color-bg-secondary': '#f1f5f9',
      '--color-bg-tertiary': '#e2e8f0',
      '--color-bg-card': '#ffffff',
      '--color-bg-hover': '#f1f5f9',
      '--color-bg-elevated': '#ffffff',
      '--color-text-primary': '#0f172a',
      '--color-text-secondary': '#475569',
      '--color-text-muted': '#64748b',
      '--color-text-inverse': '#f8fafc',
      '--color-accent': '#2563eb',
      '--color-accent-hover': '#1d4ed8',
      '--color-border': '#cbd5e1',
      '--color-border-light': '#f8fafc',
      '--color-border-focus': '#2563eb',
      '--color-sidebar-bg': '#ffffff', // Clean white sidebar
      '--color-sidebar-hover': 'rgba(0, 0, 0, 0.04)',
      '--color-sidebar-active': 'rgba(37, 99, 235, 0.08)',
      '--color-header-bg': 'rgba(248, 250, 252, 0.85)',
    },
  },
];

export const DEFAULT_THEME_ID = 'sapphire'; // Set Sapphire (clean carbon blue) as default instead of amber!

export function getTheme(id: string): Theme {
  return themes.find((t) => t.id === id) || themes[0];
}

export const sectionAccents: Record<string, string> = {
  '': '#3b82f6',
  dashboard: '#3b82f6',
  accounts: '#3b82f6',
  journal: '#3b82f6',
  invoices: '#3b82f6',
  'vouchers/receipt': '#3b82f6',
  'vouchers/disbursement': '#3b82f6',
  cash: '#3b82f6',
  'bank-reconciliation': '#3b82f6',
  banks: '#3b82f6',
  currencies: '#3b82f6',
  'fixed-assets': '#3b82f6',
  projects: '#10b981',
  boq: '#10b981',
  'progress-billing': '#10b981',
  quotations: '#10b981',
  'purchases/orders': '#0d9488',
  'purchases/invoices': '#0d9488',
  inventory: '#0d9488',
  subcontractors: '#8b5cf6',
  employees: '#ec4899',
  payroll: '#ec4899',
  'salary-sheets': '#ec4899',
  'daily-workers': '#ec4899',
  custodies: '#ec4899',
  reports: '#eab308',
  settings: '#64748b',
  contacts: '#64748b',
  clients: '#64748b',
  fiscal: '#64748b',
  notifications: '#64748b',
};
