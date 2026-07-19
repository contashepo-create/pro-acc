import { NextRequest } from 'next/server';
import { success, error, requireApiAuth, handleApiError } from '@/lib/api-helpers';
import { getSupabase } from '@/lib/supabase-client';
import { generateId } from '@/lib/utils';

const sb = () => getSupabase();

export async function GET(request: NextRequest) {
  try {
    const auth = await requireApiAuth(request);
    const s = sb();

    const { data: advances } = await s.from('employee_advances')
      .select('*, employees(name)')
      .eq('company_id', auth.companyId)
      .order('date', { ascending: false });

    return success({ advances: advances || [] });
  } catch (err) {
    return handleApiError(err);
  }
}

export async function POST(request: NextRequest) {
  try {
    const auth = await requireApiAuth(request);
    const s = sb();
    const body = await request.json();

    if (!body.employee_id || !body.amount) return error('الموظف والمبلغ مطلوبان');

    const { data: advance, error: insertErr } = await s.from('employee_advances')
      .insert({
        id: generateId(),
        company_id: auth.companyId,
        employee_id: body.employee_id,
        amount: body.amount,
        remaining_amount: body.amount,
        date: body.date || new Date().toISOString().split('T')[0],
        reason: body.reason || null,
      })
      .select('*')
      .single();

    if (insertErr) throw insertErr;

    return success(advance, 201);
  } catch (err) {
    return handleApiError(err);
  }
}
