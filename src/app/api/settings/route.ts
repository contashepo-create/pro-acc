import { NextRequest } from 'next/server';
import { success, error, requireApiAuth, requireManagerOrAbove, handleApiError, requireModulePermission } from '@/lib/api-helpers';
import { getSupabase } from '@/lib/supabase-client';

const sb = () => getSupabase();

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

/**
 * GET /api/settings
 * Get company settings + company info
 */
export async function GET(request: NextRequest) {
  try {
    const auth = await requireModulePermission(request, 'settings', 'read');
    const s = sb();

    // Fetch all settings for this company (no whitelist filtering)
    const { data: settings } = await s.from('settings')
      .select('key, value')
      .eq('company_id', auth.companyId);

    const settingsMap: Record<string, any> = {};
    (settings || []).forEach((item: any) => {
      try {
        settingsMap[item.key] = JSON.parse(item.value);
      } catch {
        settingsMap[item.key] = item.value;
      }
    });

    // Always fetch company info
    const { data: company } = await s.from('companies')
      .select('name, commercial_registration, tax_number, phone, email, address, country, country_code, currency_code, currency_symbol, locale, vat_rate')
      .eq('id', auth.companyId)
      .maybeSingle();

    return success({ ...settingsMap, company: company || {} });
  } catch (err) {
    console.error('Failed to fetch settings:', err);
    return handleApiError(err);
  }
}

/**
 * PUT /api/settings
 * Update company settings and/or company info
 * Body: { settings: {key: value}, company: {field: value} }
 */
export async function PUT(request: NextRequest) {
  try {
    // SECURITY: إعدادات الشركة يديرها المدير فأعلى. حقول الشركة الأساسية
    // (الاسم/الرقم الضريبي/نسبة الضريبة) يتطلبها مدير نظام. سابقاً كان أي
    // مستخدم مصادَق (حتى supervisor) يستطيع تغيير vat_rate/tax_number.
    const auth = await requireManagerOrAbove(request);
    const body = await request.json();
    const s = sb();

    // Save settings key-value pairs (operational preferences — manager+)
    if (body.settings && typeof body.settings === 'object') {
      const updates = Object.entries(body.settings).map(([key, value]) => ({
        company_id: auth.companyId,
        key,
        value: typeof value === 'object' ? JSON.stringify(value) : String(value),
        updated_at: new Date().toISOString(),
      }));

      if (updates.length > 0) {
        // A swallowed failure here returned {updated:true} while nothing was
        // saved, so the user believed a setting (including VAT-relevant
        // preferences) had been applied when it had not.
        const { error: settingsError } = await s.from('settings')
          .upsert(updates, { onConflict: 'company_id,key' });
        if (settingsError) throw settingsError;
      }
    }

    // Update company fields if provided — ADMIN ONLY (sensitive financial/identity)
    if (body.company && typeof body.company === 'object') {
      if (auth.role !== 'admin') {
        return error('تعديل البيانات الأساسية للشركة (الاسم، الرقم الضريبي، نسبة الضريبة، العنوان...) يتطلب صلاحيات مدير نظام', 403);
      }

      const { getCountryConfig } = await import('@/lib/countries');
      const companyUpdate: any = {};

      if (body.company.name !== undefined) {
        if (typeof body.company.name !== 'string' || !body.company.name.trim()) {
          return error('اسم الشركة غير صالح', 400);
        }
        companyUpdate.name = body.company.name.trim();
      }
      if (body.company.tax_number !== undefined) companyUpdate.tax_number = body.company.tax_number;
      if (body.company.commercial_registration !== undefined) companyUpdate.commercial_registration = body.company.commercial_registration;
      if (body.company.phone !== undefined) companyUpdate.phone = body.company.phone;
      if (body.company.email !== undefined) {
        if (body.company.email !== '' && !EMAIL_RE.test(body.company.email)) {
          return error('صيغة البريد الإلكتروني غير صحيحة', 400);
        }
        companyUpdate.email = body.company.email;
      }
      if (body.company.address !== undefined) companyUpdate.address = body.company.address;

      // Country change updates currency/vat automatically
      if (body.company.country_code !== undefined) {
        const cc = getCountryConfig(body.company.country_code);
        companyUpdate.country = cc.name;
        companyUpdate.country_code = cc.code;
        companyUpdate.currency_code = cc.currencyCode;
        companyUpdate.currency_symbol = cc.currencySymbol;
        companyUpdate.locale = cc.locale;
        companyUpdate.vat_rate = cc.vatRate;
      }

      // Allow manual override of vat_rate — must be a valid fraction [0, 1]
      // (تُخزَّن ككسر لأن فواتير المبيعات تضرب بها: subtotal × vat_rate)
      if (body.company.vat_rate !== undefined) {
        const v = Number(body.company.vat_rate);
        if (!isFinite(v) || v < 0 || v > 1) {
          return error('نسبة الضريبة غير صالحة — يجب أن تكون كسراً بين 0 و 1 (مثلاً 0.15 لـ 15%)', 400);
        }
        companyUpdate.vat_rate = v;
      }

      if (Object.keys(companyUpdate).length > 0) {
        companyUpdate.updated_at = new Date().toISOString();
        // The tenant IS the row here: `companies` is keyed by id and has no
        // company_id column, so the extra .eq('company_id', ...) filter made
        // PostgREST reject the request (42703). Combined with the ignored
        // error, changing the company VAT rate or tax number silently did
        // nothing while the UI reported success.
        const { error: companyError } = await s.from('companies')
          .update(companyUpdate)
          .eq('id', auth.companyId);
        if (companyError) throw companyError;
      }
    }

    return success({ updated: true });
  } catch (err) {
    console.error('Failed to update settings:', err);
    return handleApiError(err);
  }
}
