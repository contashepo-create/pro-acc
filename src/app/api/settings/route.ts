import { NextRequest } from 'next/server';
import { success, error, handleApiError, parseBody, requireApiAuth } from '@/lib/api-helpers';
import { getSupabase } from '@/lib/supabase-client';

// @ts-ignore
const sb = () => getSupabase() as any;

export async function GET(req: NextRequest) {
  try {
    const auth = await requireApiAuth(req);
    const s = sb();

    // Get company info
    const { data: company } = await s.from('companies')
      .select('id, name, commercial_registration, tax_number, phone, email, address, currency_symbol')
      .eq('id', auth.companyId).single();

    // Get settings
    const { data: settingsData } = await s.from('settings')
      .select('key, value').eq('company_id', auth.companyId);

    const settingsMap: Record<string, string> = {};
    for (const row of (settingsData || [])) { settingsMap[row.key] = row.value; }

    return success({ company: company || {}, settings: settingsMap });
  } catch (err) {
    return handleApiError(err);
  }
}

export async function PUT(req: NextRequest) {
  try {
    const auth = await requireApiAuth(req);
    const s = sb();
    const body = await parseBody(req);

    // If body has company fields, update the companies table directly
    const companyFields = ['company_name', 'commercial_registration', 'tax_number', 'phone', 'email', 'address', 'currency_symbol'];
    const companyUpdate: any = {};

    for (const field of companyFields) {
      if (body[field] !== undefined) {
        const dbField = field === 'company_name' ? 'name' : field;
        companyUpdate[dbField] = body[field];
      }
    }

    if (Object.keys(companyUpdate).length > 0) {
      companyUpdate.updated_at = new Date().toISOString();
      const { error: updateErr } = await s.from('companies')
        .update(companyUpdate).eq('id', auth.companyId);
      if (updateErr) throw updateErr;
    }

    // Also save key-value settings if provided
    if (body.settings) {
      for (const [key, value] of Object.entries(body.settings)) {
        const { data: existing } = await s.from('settings')
          .select('id').eq('company_id', auth.companyId).eq('key', key).maybeSingle();
        if (existing) {
          await s.from('settings').update({ value: String(value) }).eq('id', existing.id);
        } else {
          await s.from('settings').insert({ company_id: auth.companyId, key, value: String(value) });
        }
      }
    }

    return success({ updated: true });
  } catch (err) {
    return handleApiError(err);
  }
}
