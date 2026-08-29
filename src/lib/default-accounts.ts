/**
 * Default Chart of Accounts Template
 * Standard accounts that every company needs, pre-created on registration
 * Based on Saudi accounting standards and suitable for all industries
 * شجرة حسابات سعودية/IFRS للشركات والمقاولات — الحسابات الرئيسية غير قابلة للترحيل
 * والحسابات الفرعية هي حسابات ترحيل حقيقية ترتبط بالوحدات (بنوك، خزائن، ضريبة، رواتب…).
 */
import { HEADER_ACCOUNT_CODES } from '@/lib/account-resolve';

import type { Row, SupabaseLike } from './types';

export interface DefaultAccount {
  code: string;
  name: string;
  nameEn: string;
  type: 'asset' | 'liability' | 'equity' | 'revenue' | 'expense';
  parentCode?: string;
  isHeader?: boolean;
}

export const DEFAULT_CHART_OF_ACCOUNTS: DefaultAccount[] = [
  // الأصول - Assets 1000-1999
  { code: '1000', name: 'الأصول', nameEn: 'Assets', type: 'asset', isHeader: true },
  { code: '1100', name: 'الأصول المتداولة', nameEn: 'Current Assets', type: 'asset', parentCode: '1000', isHeader: true },
  { code: '1110', name: 'الخزينة', nameEn: 'Cash on Hand', type: 'asset', parentCode: '1100' },
  { code: '1120', name: 'البنوك', nameEn: 'Banks', type: 'asset', parentCode: '1100' },
  { code: '1130', name: 'العملاء - ذمم مدينة', nameEn: 'Accounts Receivable - Clients', type: 'asset', parentCode: '1100' },
  { code: '1135', name: 'إيرادات مستحقة', nameEn: 'Accrued Revenue', type: 'asset', parentCode: '1100' },
  { code: '1140', name: 'مصروفات مدفوعة مقدماً', nameEn: 'Prepaid Expenses', type: 'asset', parentCode: '1100' },
  { code: '1150', name: 'عهد الموظفين', nameEn: 'Employee Custodies', type: 'asset', parentCode: '1100' },
  { code: '1160', name: 'سلف الموظفين', nameEn: 'Employee Advances', type: 'asset', parentCode: '1100' },
  { code: '1170', name: 'المخزون', nameEn: 'Inventory', type: 'asset', parentCode: '1100' },
  { code: '1180', name: 'ضريبة القيمة المضافة - مشتريات', nameEn: 'VAT - Purchases', type: 'asset', parentCode: '1100' },
  { code: '1190', name: 'دفعات مقدمة لموردين', nameEn: 'Advance to Suppliers', type: 'asset', parentCode: '1100' },
  { code: '1191', name: 'دفعات مقدمة لمقاولي باطن', nameEn: 'Subcontractor Advances', type: 'asset', parentCode: '1100' },
  { code: '1185', name: 'خطابات ضمان ابتدائية', nameEn: 'Bid Bond Margins', type: 'asset', parentCode: '1100' },
  { code: '1186', name: 'خطابات ضمان نهائية', nameEn: 'Performance Bond Margins', type: 'asset', parentCode: '1100' },
  
  { code: '1200', name: 'الأصول الثابتة', nameEn: 'Fixed Assets', type: 'asset', parentCode: '1000', isHeader: true },
  { code: '1210', name: 'الأراضي', nameEn: 'Lands', type: 'asset', parentCode: '1200' },
  { code: '1220', name: 'المباني', nameEn: 'Buildings', type: 'asset', parentCode: '1200' },
  { code: '1230', name: 'الآلات والمعدات', nameEn: 'Machinery & Equipment', type: 'asset', parentCode: '1200' },
  { code: '1240', name: 'السيارات', nameEn: 'Vehicles', type: 'asset', parentCode: '1200' },
  { code: '1250', name: 'الأثاث والمفروشات', nameEn: 'Furniture', type: 'asset', parentCode: '1200' },
  { code: '1260', name: 'أجهزة الحاسب', nameEn: 'Computers', type: 'asset', parentCode: '1200' },
  { code: '1290', name: 'مجمع إهلاك الأصول الثابتة', nameEn: 'Accumulated Depreciation', type: 'asset', parentCode: '1200' },

  // الخصوم - Liabilities 2000-2999
  { code: '2000', name: 'الخصوم', nameEn: 'Liabilities', type: 'liability', isHeader: true },
  { code: '2100', name: 'الخصوم المتداولة', nameEn: 'Current Liabilities', type: 'liability', parentCode: '2000', isHeader: true },
  { code: '2110', name: 'الموردون - ذمم دائنة', nameEn: 'Accounts Payable - Suppliers', type: 'liability', parentCode: '2100' },
  { code: '2120', name: 'ضريبة القيمة المضافة - مبيعات', nameEn: 'VAT - Sales', type: 'liability', parentCode: '2100' },
  { code: '2130', name: 'القروض قصيرة الأجل', nameEn: 'Short-term Loans', type: 'liability', parentCode: '2100' },
  { code: '2140', name: 'رواتب مستحقة', nameEn: 'Accrued Salaries', type: 'liability', parentCode: '2100' },
  { code: '2145', name: 'مصروفات مستحقة', nameEn: 'Accrued Expenses', type: 'liability', parentCode: '2100' },
  { code: '2155', name: 'مستحقات التأمينات الاجتماعية', nameEn: 'Social insurance payable', type: 'liability', parentCode: '2100' },
  { code: '2150', name: 'مقاولو باطن - مستحق', nameEn: 'Subcontractors Payable', type: 'liability', parentCode: '2100' },
  { code: '2160', name: 'محجوزات ضمان', nameEn: 'Retentions Payable', type: 'liability', parentCode: '2100' },
  { code: '2170', name: 'عمالة يومية مستحقة', nameEn: 'Daily Workers Payable', type: 'liability', parentCode: '2100' },
  { code: '2180', name: 'دفعات مقدمة من عملاء', nameEn: 'Advances from Clients', type: 'liability', parentCode: '2100' },
  { code: '2190', name: 'مكافأة نهاية الخدمة', nameEn: 'End of Service Benefits', type: 'liability', parentCode: '2200' },
  
  { code: '2200', name: 'الخصوم غير المتداولة', nameEn: 'Non-current Liabilities', type: 'liability', parentCode: '2000', isHeader: true },
  { code: '2210', name: 'القروض طويلة الأجل', nameEn: 'Long-term Loans', type: 'liability', parentCode: '2200' },

  // حقوق الملكية - Equity 3000-3999
  { code: '3000', name: 'حقوق الملكية', nameEn: 'Equity', type: 'equity', isHeader: true },
  { code: '3100', name: 'رأس المال', nameEn: 'Capital', type: 'equity', parentCode: '3000' },
  { code: '3200', name: 'الأرباح المحتجزة', nameEn: 'Retained Earnings', type: 'equity', parentCode: '3000' },
  { code: '3300', name: 'أرباح العام', nameEn: 'Current Year Earnings', type: 'equity', parentCode: '3000' },

  // الإيرادات - Revenue 4000-4999
  { code: '4000', name: 'الإيرادات', nameEn: 'Revenue', type: 'revenue', isHeader: true },
  { code: '4100', name: 'إيرادات النشاط', nameEn: 'Operating Revenue', type: 'revenue', parentCode: '4000' },
  { code: '4110', name: 'إيرادات صيانة', nameEn: 'Maintenance Revenue', type: 'revenue', parentCode: '4000' },
  { code: '4120', name: 'إيرادات استشارات', nameEn: 'Consulting Revenue', type: 'revenue', parentCode: '4000' },
  { code: '4200', name: 'إيرادات أخرى', nameEn: 'Other Revenue', type: 'revenue', parentCode: '4000' },
  { code: '4250', name: 'خصم مكتسب', nameEn: 'Discount Received', type: 'revenue', parentCode: '4000' },
  { code: '4300', name: 'إيرادات فوائد', nameEn: 'Interest Income', type: 'revenue', parentCode: '4000' },

  // المصروفات - Expenses 5000-5999
  { code: '5000', name: 'المصروفات', nameEn: 'Expenses', type: 'expense', isHeader: true },
  { code: '5100', name: 'تكلفة مباشرة', nameEn: 'Direct Costs', type: 'expense', parentCode: '5000' },
  { code: '5110', name: 'مواد خام', nameEn: 'Raw Materials', type: 'expense', parentCode: '5100' },
  { code: '5120', name: 'أجور عمالة مباشرة', nameEn: 'Direct Labor', type: 'expense', parentCode: '5100' },
  { code: '5130', name: 'تكاليف مقاولي باطن', nameEn: 'Subcontractor Costs', type: 'expense', parentCode: '5100' },
  { code: '5140', name: 'إيجار معدات', nameEn: 'Equipment Rental', type: 'expense', parentCode: '5100' },
  { code: '5410', name: 'مصاريف مناقصات تحت التسوية', nameEn: 'Tender Costs in Suspense', type: 'expense', parentCode: '5100' },
  { code: '5195', name: 'تكاليف ما قبل التعاقد', nameEn: 'Pre-contract Tender Costs', type: 'expense', parentCode: '5100' },
  
  { code: '5200', name: 'مصروفات تشغيلية', nameEn: 'Operating Expenses', type: 'expense', parentCode: '5000', isHeader: true },
  { code: '5210', name: 'رواتب وأجور', nameEn: 'Salaries & Wages', type: 'expense', parentCode: '5200' },
  { code: '5215', name: 'مصروف التأمينات الاجتماعية', nameEn: 'Social insurance expense', type: 'expense', parentCode: '5200' },
  { code: '5216', name: 'مصروف مستحقات نهاية الخدمة', nameEn: 'End of service expense', type: 'expense', parentCode: '5200' },
  { code: '5220', name: 'إيجارات', nameEn: 'Rent', type: 'expense', parentCode: '5200' },
  { code: '5230', name: 'كهرباء ومياه', nameEn: 'Utilities', type: 'expense', parentCode: '5200' },
  { code: '5240', name: 'اتصالات وانترنت', nameEn: 'Communication', type: 'expense', parentCode: '5200' },
  { code: '5250', name: 'صيانة', nameEn: 'Maintenance', type: 'expense', parentCode: '5200' },
  { code: '5260', name: 'إهلاك', nameEn: 'Depreciation', type: 'expense', parentCode: '5200' },
  { code: '5270', name: 'محروقات', nameEn: 'Fuel', type: 'expense', parentCode: '5200' },
  { code: '5280', name: 'قرطاسية ومطبوعات', nameEn: 'Stationery', type: 'expense', parentCode: '5200' },
  { code: '5290', name: 'مصروفات بنكية', nameEn: 'Bank Charges', type: 'expense', parentCode: '5200' },
  { code: '5291', name: 'عمولات بنكية لضمانات', nameEn: 'Bank Guarantee Commissions', type: 'expense', parentCode: '5200' },
  
  { code: '5300', name: 'مصروفات تسويقية', nameEn: 'Marketing Expenses', type: 'expense', parentCode: '5000' },
  { code: '5400', name: 'مصروفات إدارية وعمومية', nameEn: 'General & Admin Expenses', type: 'expense', parentCode: '5000' },
  { code: '5420', name: 'مصاريف مناقصات خاسرة', nameEn: 'Lost Tender Costs', type: 'expense', parentCode: '5400' },
];

async function insertAccount(supabase: SupabaseLike, row: Record<string, unknown>) {
  const first = await supabase.from('accounts').insert(row).select('id').single();
  if (!first.error && first.data) return first;
  const msg = `${first.error?.message || ''} ${first.error?.code || ''}`;
  if (/is_header|42703|Could not find/i.test(msg)) {
    const { is_header: _drop, ...rest } = row as Row;
    return supabase.from('accounts').insert(rest).select('id').single();
  }
  return first;
}

export async function ensureDefaultCashSafe(supabase: SupabaseLike, companyId: string, cashAccountId?: string | null) {
  const { data: existing } = await supabase
    .from('banks_safes')
    .select('id')
    .eq('company_id', companyId)
    .eq('type', 'safe')
    .limit(1)
    .maybeSingle();

  if (existing) return existing.id as string;

  let accountId = cashAccountId || null;
  if (!accountId) {
    const { data: cash } = await supabase
      .from('accounts')
      .select('id')
      .eq('company_id', companyId)
      .eq('code', '1110')
      .maybeSingle();
    accountId = cash?.id == null ? null : String(cash.id);
  }
  if (!accountId) return null;

  const { data: created } = await supabase
    .from('banks_safes')
    .insert({
      company_id: companyId,
      name: 'الخزينة الرئيسية',
      type: 'safe',
      account_id: accountId,
      opening_balance: 0,
      is_active: true,
    })
    .select('id')
    .single();

  return created?.id || null;
}

export async function createDefaultChartOfAccounts(supabase: SupabaseLike, companyId: string) {
  const accountMap = new Map<string, string>(); // code -> id

  // First pass: create all accounts without parent
  for (const acc of DEFAULT_CHART_OF_ACCOUNTS) {
    try {
      const { data: existing } = await supabase
        .from('accounts')
        .select('id')
        .eq('company_id', companyId)
        .eq('code', acc.code)
        .maybeSingle();

      if (existing) {
        accountMap.set(String(acc.code), String(existing.id));
        const shouldHeader = !!acc.isHeader || HEADER_ACCOUNT_CODES.has(acc.code);
        if (shouldHeader) {
          await supabase
            .from('accounts')
            .update({ is_header: true })
            .eq('id', existing.id)
            .eq('company_id', companyId);
        }
        continue;
      }

      const isHeader = !!acc.isHeader || HEADER_ACCOUNT_CODES.has(acc.code);
      const { data, error } = await insertAccount(supabase, {
        company_id: companyId,
        code: acc.code,
        name: acc.name,
        name_en: acc.nameEn,
        type: acc.type,
        parent_id: null,
        is_active: true,
        is_header: isHeader,
      });

      if (!error && data) {
        accountMap.set(String(acc.code), String(data.id));
      }
    } catch (e) {
      console.warn(`Failed to create account ${acc.code}:`, e);
    }
  }

  // Second pass: update parent_id
  for (const acc of DEFAULT_CHART_OF_ACCOUNTS) {
    if (acc.parentCode && accountMap.has(acc.code) && accountMap.has(acc.parentCode)) {
      try {
        await supabase
          .from('accounts')
          .update({ parent_id: accountMap.get(acc.parentCode) })
          .eq('id', accountMap.get(acc.code)!)
          .eq('company_id', companyId);
      } catch (e) {
        console.warn(`Failed to update parent for ${acc.code}:`, e);
      }
    }
  }

  // الخزينة في الدليل = خزينة حقيقية في قسم البنوك والخزائن
  try {
    await ensureDefaultCashSafe(supabase, companyId, accountMap.get('1110') || null);
  } catch (e) {
    console.warn('Failed to ensure default cash safe:', e);
  }

  return accountMap.size;
}
