import { NextRequest } from 'next/server';
import { getSupabase } from '@/lib/supabase-client';
import { handleApiError, success, error, parseBody, requireModulePermission } from '@/lib/api-helpers';

const sb = () => getSupabase() as any;

export async function GET(req: NextRequest) {
  try {
    const auth = await requireModulePermission(req, 'pos', 'read');
    const { data, error: queryError } = await sb().from('pos_terminals')
      .select('*, banks_safes(name)').eq('company_id', auth.companyId).order('code');
    if (queryError) throw queryError;
    return success({ terminals: data || [] });
  } catch (err) {
    return handleApiError(err);
  }
}

export async function POST(req: NextRequest) {
  try {
    const auth = await requireModulePermission(req, 'pos', 'create');
    const body = await parseBody(req);
    const code = typeof body.code === 'string' ? body.code.trim() : '';
    const name = typeof body.name === 'string' ? body.name.trim() : '';
    if (!code || code.length > 100 || !name || name.length > 300 || !body.bank_safe_id) {
      return error('الكود والاسم والخزينة مطلوبة');
    }
    const s = sb();
    const { data: bank, error: bankError } = await s.from('banks_safes')
      .select('id').eq('id', body.bank_safe_id).eq('company_id', auth.companyId)
      .eq('is_active', true).maybeSingle();
    if (bankError) throw bankError;
    if (!bank) return error('الخزينة غير موجودة', 404);
    const { data, error: insertError } = await s.from('pos_terminals')
      .insert({ company_id: auth.companyId, code, name, bank_safe_id: body.bank_safe_id })
      .select().single();
    if (insertError) throw insertError;
    return success(data, 201);
  } catch (err) {
    return handleApiError(err);
  }
}
