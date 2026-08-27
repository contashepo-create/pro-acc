/**
 * إعدادات الدول المدعومة
 * كل دولة لها: رمز، اسم، عملة، نسبة ضريبة، لغة، جهة ضريبية
 */

export interface CountryConfig {
  code: string;
  name: string;
  nameEn: string;
  currencyCode: string;
  currencySymbol: string;
  vatRate: number;
  locale: string;
  taxAuthority: 'zatca' | 'fta' | 'eta' | 'std' | 'none';
  phoneCode: string;
}

export const COUNTRIES: CountryConfig[] = [
  { code: 'SA', name: 'السعودية', nameEn: 'Saudi Arabia', currencyCode: 'SAR', currencySymbol: 'ر.س', vatRate: 0.15, locale: 'ar-SA', taxAuthority: 'zatca', phoneCode: '+966' },
  { code: 'AE', name: 'الإمارات', nameEn: 'UAE', currencyCode: 'AED', currencySymbol: 'د.إ', vatRate: 0.05, locale: 'ar-AE', taxAuthority: 'fta', phoneCode: '+971' },
  { code: 'EG', name: 'مصر', nameEn: 'Egypt', currencyCode: 'EGP', currencySymbol: 'ج.م', vatRate: 0.14, locale: 'ar-EG', taxAuthority: 'eta', phoneCode: '+20' },
  { code: 'JO', name: 'الأردن', nameEn: 'Jordan', currencyCode: 'JOD', currencySymbol: 'د.أ', vatRate: 0.16, locale: 'ar-JO', taxAuthority: 'std', phoneCode: '+962' },
  { code: 'KW', name: 'الكويت', nameEn: 'Kuwait', currencyCode: 'KWD', currencySymbol: 'د.ك', vatRate: 0, locale: 'ar-KW', taxAuthority: 'none', phoneCode: '+965' },
  { code: 'BH', name: 'البحرين', nameEn: 'Bahrain', currencyCode: 'BHD', currencySymbol: 'د.ب', vatRate: 0.10, locale: 'ar-BH', taxAuthority: 'std', phoneCode: '+973' },
  { code: 'OM', name: 'عُمان', nameEn: 'Oman', currencyCode: 'OMR', currencySymbol: 'ر.ع', vatRate: 0.05, locale: 'ar-OM', taxAuthority: 'std', phoneCode: '+968' },
  { code: 'QA', name: 'قطر', nameEn: 'Qatar', currencyCode: 'QAR', currencySymbol: 'ر.ق', vatRate: 0, locale: 'ar-QA', taxAuthority: 'none', phoneCode: '+974' },
  { code: 'IQ', name: 'العراق', nameEn: 'Iraq', currencyCode: 'IQD', currencySymbol: 'د.ع', vatRate: 0.15, locale: 'ar-IQ', taxAuthority: 'std', phoneCode: '+964' },
  { code: 'YE', name: 'اليمن', nameEn: 'Yemen', currencyCode: 'YER', currencySymbol: 'ر.ي', vatRate: 0.05, locale: 'ar-YE', taxAuthority: 'std', phoneCode: '+967' },
  { code: 'PS', name: 'فلسطين', nameEn: 'Palestine', currencyCode: 'ILS', currencySymbol: '₪', vatRate: 0.17, locale: 'ar-PS', taxAuthority: 'std', phoneCode: '+970' },
  { code: 'LB', name: 'لبنان', nameEn: 'Lebanon', currencyCode: 'LBP', currencySymbol: 'ل.ل', vatRate: 0.11, locale: 'ar-LB', taxAuthority: 'std', phoneCode: '+961' },
  { code: 'SY', name: 'سوريا', nameEn: 'Syria', currencyCode: 'SYP', currencySymbol: 'ل.س', vatRate: 0.15, locale: 'ar-SY', taxAuthority: 'std', phoneCode: '+963' },
  { code: 'SD', name: 'السودان', nameEn: 'Sudan', currencyCode: 'SDG', currencySymbol: 'ج.س', vatRate: 0.17, locale: 'ar-SD', taxAuthority: 'std', phoneCode: '+249' },
  { code: 'LY', name: 'ليبيا', nameEn: 'Libya', currencyCode: 'LYD', currencySymbol: 'د.ل', vatRate: 0.16, locale: 'ar-LY', taxAuthority: 'std', phoneCode: '+218' },
  { code: 'MA', name: 'المغرب', nameEn: 'Morocco', currencyCode: 'MAD', currencySymbol: 'د.م', vatRate: 0.20, locale: 'ar-MA', taxAuthority: 'std', phoneCode: '+212' },
  { code: 'DZ', name: 'الجزائر', nameEn: 'Algeria', currencyCode: 'DZD', currencySymbol: 'د.ج', vatRate: 0.19, locale: 'ar-DZ', taxAuthority: 'std', phoneCode: '+213' },
  { code: 'TN', name: 'تونس', nameEn: 'Tunisia', currencyCode: 'TND', currencySymbol: 'د.ت', vatRate: 0.19, locale: 'ar-TN', taxAuthority: 'std', phoneCode: '+216' },
  { code: 'MR', name: 'موريتانيا', nameEn: 'Mauritania', currencyCode: 'MRU', currencySymbol: 'أ.م', vatRate: 0.16, locale: 'ar-MR', taxAuthority: 'std', phoneCode: '+222' },
  { code: 'SO', name: 'الصومال', nameEn: 'Somalia', currencyCode: 'SOS', currencySymbol: 'ش.س', vatRate: 0.05, locale: 'ar-SO', taxAuthority: 'std', phoneCode: '+252' },
  { code: 'DJ', name: 'جيبوتي', nameEn: 'Djibouti', currencyCode: 'DJF', currencySymbol: 'ف.ج', vatRate: 0.10, locale: 'ar-DJ', taxAuthority: 'std', phoneCode: '+253' },
  { code: 'KM', name: 'جزر القمر', nameEn: 'Comoros', currencyCode: 'KMF', currencySymbol: 'ف.ق', vatRate: 0.10, locale: 'ar-KM', taxAuthority: 'std', phoneCode: '+269' },
];

const DEFAULT_COUNTRY: CountryConfig = COUNTRIES[0];

export function getCountryConfig(code: string): CountryConfig {
  return COUNTRIES.find(c => c.code === code) || DEFAULT_COUNTRY;
}

export function getCountriesList(): { value: string; label: string }[] {
  return COUNTRIES.map(c => ({ value: c.code, label: c.name }));
}
