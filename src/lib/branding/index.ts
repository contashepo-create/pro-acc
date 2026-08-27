import { escapeHtml } from '@/lib/utils';

/**
 * White-Label / Multi-Brand System
 * 
 * Allows each company to have custom branding:
 * - Logo URL
 * - Primary/secondary colors
 * - Custom domain (future)
 * - Invoice template selection
 * - Footer text
 * 
 * Usage in React:
 *   const branding = useBranding(companyId);
 *   <div style={{ color: branding.primaryColor }}>{branding.companyName}</div>
 */

export interface CompanyBranding {
  companyId: string;
  companyName: string;
  logoUrl: string | null;
  primaryColor: string;
  secondaryColor: string;
  accentColor: string;
  invoiceTemplate: 'modern' | 'classic' | 'minimal';
  footerText: string;
  currencySymbol: string;
  dateFormat: string;
}

const DEFAULT_BRANDING: Omit<CompanyBranding, 'companyId' | 'companyName'> = {
  logoUrl: null,
  primaryColor: '#2563eb',     // Blue-600
  secondaryColor: '#64748b',   // Slate-500
  accentColor: '#f59e0b',      // Amber-500
  invoiceTemplate: 'modern',
  footerText: '',
  currencySymbol: 'ر.س',
  dateFormat: 'ar-SA',
};

/**
 * Get company branding from database
 * Falls back to defaults if not configured
 */
export async function getCompanyBranding(companyId: string): Promise<CompanyBranding> {
  try {
    const { getSupabase } = await import('@/lib/supabase-client');
    const s = getSupabase();

    const { data: company } = await s.from('companies')
      .select('id, name, logo_url, primary_color, secondary_color, accent_color, invoice_template, footer_text, currency_symbol')
      .eq('id', companyId)
      .maybeSingle();

    if (!company) {
      return { ...DEFAULT_BRANDING, companyId, companyName: 'Unknown' };
    }

    const c = company as Record<string, string | null>;

    return {
      companyId,
      companyName: c.name || 'Unknown',
      logoUrl: c.logo_url || DEFAULT_BRANDING.logoUrl,
      primaryColor: c.primary_color || DEFAULT_BRANDING.primaryColor,
      secondaryColor: c.secondary_color || DEFAULT_BRANDING.secondaryColor,
      accentColor: c.accent_color || DEFAULT_BRANDING.accentColor,
      invoiceTemplate: (c.invoice_template as CompanyBranding['invoiceTemplate']) || DEFAULT_BRANDING.invoiceTemplate,
      footerText: c.footer_text || DEFAULT_BRANDING.footerText,
      currencySymbol: c.currency_symbol || DEFAULT_BRANDING.currencySymbol,
      dateFormat: DEFAULT_BRANDING.dateFormat,
    };
  } catch {
    return { ...DEFAULT_BRANDING, companyId, companyName: 'Unknown' };
  }
}

/**
 * Generate CSS variables from branding for theming
 */
export function brandingToCSS(branding: CompanyBranding): Record<string, string> {
  return {
    '--brand-primary': branding.primaryColor,
    '--brand-secondary': branding.secondaryColor,
    '--brand-accent': branding.accentColor,
  };
}

/**
 * Predefined invoice templates
 */
export const INVOICE_TEMPLATES = {
  modern: {
    name: 'عصري',
    nameEn: 'Modern',
    headerStyle: 'gradient',
    showLogo: true,
    showQRProminent: true,
    tableBorder: false,
    footerStyle: 'compact',
  },
  classic: {
    name: 'كلاسيكي',
    nameEn: 'Classic',
    headerStyle: 'solid',
    showLogo: true,
    showQRProminent: true,
    tableBorder: true,
    footerStyle: 'detailed',
  },
  minimal: {
    name: 'بسيط',
    nameEn: 'Minimal',
    headerStyle: 'none',
    showLogo: false,
    showQRProminent: false,
    tableBorder: false,
    footerStyle: 'compact',
  },
} as const;

/**
 * Generate a PDF-ready invoice header with branding
 */
export function generateInvoiceHeader(branding: CompanyBranding): string {
  const template = INVOICE_TEMPLATES[branding.invoiceTemplate];
  const safeColor = (value: string, fallback: string) => /^#[0-9a-f]{3,8}$/i.test(value) ? value : fallback;
  const primaryColor = safeColor(branding.primaryColor, DEFAULT_BRANDING.primaryColor);
  const secondaryColor = safeColor(branding.secondaryColor, DEFAULT_BRANDING.secondaryColor);
  const companyName = escapeHtml(branding.companyName);
  const footerText = escapeHtml(branding.footerText);
  const logoUrl = branding.logoUrl ? escapeHtml(branding.logoUrl) : null;
  
  let html = `<div class="invoice-header" style="
    ${template.headerStyle === 'gradient'
      ? `background: linear-gradient(135deg, ${primaryColor}, ${secondaryColor});`
      : template.headerStyle === 'solid'
        ? `background: ${primaryColor};`
        : ''
    }
    color: white;
    padding: 24px;
    border-radius: 8px;
    display: flex;
    justify-content: space-between;
    align-items: center;
    margin-bottom: 24px;
  ">`;

  // Logo
  if (template.showLogo && logoUrl) {
    html += `<img src="${logoUrl}" alt="${companyName}" style="max-height: 60px;" />`;
  }

  // Company name
  html += `<div>
    <h1 style="font-size: 24px; margin: 0; ${template.headerStyle === 'none' ? 'color: #1f2937' : ''}">${companyName}</h1>
    ${footerText ? `<p style="opacity: 0.8; margin: 4px 0 0; font-size: 12px;">${footerText}</p>` : ''}
  </div>`;

  html += `</div>`;
  return html;
}
