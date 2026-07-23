import { NextRequest } from 'next/server';
import { success, error, requireApiAuth } from '@/lib/api-helpers';
import { getSupabase } from '@/lib/supabase-client';

const sb = () => getSupabase();

/**
 * GET /api/settings
 * Get company settings with key validation
 */
export async function GET(request: NextRequest) {
  try {
    const auth = await requireApiAuth(request);
    const s = sb();

    // Only fetch whitelisted keys
    const { data: allowedKeys } = await s.from('allowed_settings_keys')
      .select('key_name')
      .eq('is_sensitive', false);

    const validKeys = (allowedKeys || []).map((k: any) => k.key_name);

    if (validKeys.length === 0) {
      return success({});
    }

    const { data: settings } = await s.from('settings')
      .select('key, value')
      .eq('company_id', auth.companyId)
      .in('key', validKeys);

    // Also fetch company info (country, currency, vat_rate)
    const { data: company } = await s.from('companies')
      .select('name, commercial_registration, tax_number, phone, email, address, country, country_code, currency_code, currency_symbol, locale, vat_rate')
      .eq('id', auth.companyId)
      .maybeSingle();

    const settingsMap: Record<string, any> = {};
    (settings || []).forEach((item: any) => {
      try {
        settingsMap[item.key] = JSON.parse(item.value);
      } catch {
        settingsMap[item.key] = item.value;
      }
    });

    return success({ ...settingsMap, company: company || {} });
  } catch (err) {
    console.error('Failed to fetch settings:', err);
    return error('فشل تحميل الإعدادات', 500);
  }
}

/**
 * PUT /api/settings
 * Update company settings with validation
 */
export async function PUT(request: NextRequest) {
  try {
    const auth = await requireApiAuth(request);
    const body = await request.json();
    const s = sb();

    // Validate that we're only updating whitelisted keys
    const { data: allowedKeys } = await s.from('allowed_setting_keys')
      .select('key_name');

    const validKeys = new Set((allowedKeys || []).map((k: any) => k.key_name));

    // Filter to only valid keys, silently skip unknown ones
    const settingsToUpdate = Object.entries(body.settings || {}).filter(
      ([key]) => validKeys.has(key)
    );

    // Update each setting
    const updates = settingsToUpdate.map(([key, value]) => ({
      company_id: auth.companyId,
      key,
      value: typeof value === 'object' ? JSON.stringify(value) : String(value),
      updated_at: new Date().toISOString(),
    }));

    // Update company fields if provided
    if (body.company) {
      const { getCountryConfig } = await import('@/lib/countries');
      const companyUpdate: any = {};

      if (body.company.name !== undefined) companyUpdate.name = body.company.name;
      if (body.company.tax_number !== undefined) companyUpdate.tax_number = body.company.tax_number;
      if (body.company.commercial_registration !== undefined) companyUpdate.commercial_registration = body.company.commercial_registration;
      if (body.company.phone !== undefined) companyUpdate.phone = body.company.phone;
      if (body.company.email !== undefined) companyUpdate.email = body.company.email;
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

      // Allow manual override of vat_rate
      if (body.company.vat_rate !== undefined) companyUpdate.vat_rate = body.company.vat_rate;

      if (Object.keys(companyUpdate).length > 0) {
        companyUpdate.updated_at = new Date().toISOString();
        await s.from('companies').update(companyUpdate).eq('id', auth.companyId);
      }
    }

    if (updates.length > 0) {
      await s.from('settings')
        .upsert(updates, { onConflict: 'company_id,key' });
    }

    return success({ updated: true });
  } catch (err) {
    console.error('Failed to update settings:', err);
    return error('فشل تحديث الإعدادات', 500);
  }
}