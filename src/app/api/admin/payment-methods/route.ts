import { requireAdmin, adminJsonError } from '@/lib/admin-guard';
import { NextRequest } from 'next/server';
import { getSupabase } from '@/lib/supabase-client';
import { success, error, serverError, parseBody } from '@/lib/api-helpers';

const sb = () => getSupabase();



export async function GET(req: NextRequest) {
  try {
    const __admin = await requireAdmin(req);
    const s = sb();
    const { data, error: err } = await s.from('payment_methods').select('*').order('sort_order');
    if (err) throw err;
    return success({ methods: data || [] });
  } catch (e) {
    return adminJsonError(e);
  }
}

export async function POST(req: NextRequest) {
  try {
    const __admin = await requireAdmin(req);
    const body = await parseBody(req);
    const { code, name_ar, account_number, account_name, instructions, is_active } = body;
    if (!code || !name_ar) return error('code and name_ar required');

    const s = sb();
    const { data, error: err } = await s.from('payment_methods').insert({
      code,
      name_ar,
      account_number: account_number || '',
      account_name: account_name || '',
      instructions: instructions || '',
      is_active: is_active !== false,
    }).select().single();

    if (err) throw err;
    return success(data, 201);
  } catch (e) {
    return adminJsonError(e);
  }
}

export async function PUT(req: NextRequest) {
  try {
    const __admin = await requireAdmin(req);
    const body = await parseBody(req);
    const { id, ...updates } = body;
    if (!id) return error('id required');

    const s = sb();
    const { data, error: err } = await s.from('payment_methods').update({
      ...updates,
      updated_at: new Date().toISOString(),
    }).eq('id', id).select().single();

    if (err) throw err;
    return success(data);
  } catch (e) {
    return adminJsonError(e);
  }
}
