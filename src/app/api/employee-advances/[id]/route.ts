import { NextRequest } from 'next/server';
import { success, error, notFound, requireManagerOrAbove, handleApiError, requireModulePermission, parseBody } from '@/lib/api-helpers';
import { getSupabase } from '@/lib/supabase-client';
import { employeeAdvanceUpdateSchema, hrUuid } from '@/lib/hr-validation';

import type { Row } from '@/lib/types';

const ADVANCE_COLUMNS = `id,employee_id,amount,remaining_amount,date,reason,journal_entry_id,
  voucher_disbursement_id,custody_id,type,status,approved_at,created_at,employees(name)`;

async function findAdvance(companyId: string, id: string) {
  const { data, error: queryError } = await getSupabase().from('employee_advances').select(ADVANCE_COLUMNS)
    .eq('id', id).eq('company_id', companyId).maybeSingle();
  if (queryError) throw queryError;
  return data;
}

export async function GET(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const auth = await requireModulePermission(request, 'employee_advances', 'read');
    const { id } = await params;
    if (!hrUuid.safeParse(id).success) return error('معرف السلفة غير صالح');
    const advance = await findAdvance(auth.companyId, id);
    if (!advance) return notFound();
    return success({ ...advance, employee_name: (advance as Row).employees ? String(((advance as Row).employees as Row).name) || '' : '', employees: undefined });
  } catch (cause) {
    return handleApiError(cause);
  }
}

export async function PUT(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const auth = await requireManagerOrAbove(request);
    const { id } = await params;
    if (!hrUuid.safeParse(id).success) return error('معرف السلفة غير صالح');
    const parsed = employeeAdvanceUpdateSchema.safeParse(await parseBody(request));
    if (!parsed.success) return error(parsed.error.issues[0]?.message || 'بيانات السلفة غير صالحة');
    if (!await findAdvance(auth.companyId, id)) return notFound();
    const { data, error: rpcError } = await getSupabase().rpc('update_employee_advance_note_atomic', {
      p_company_id: auth.companyId,
      p_advance_id: id,
      p_reason: parsed.data.reason || '',
      p_user_id: auth.userId,
    });
    if (rpcError) throw rpcError;
    return success(data);
  } catch (cause) {
    return handleApiError(cause);
  }
}

export async function DELETE(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const auth = await requireManagerOrAbove(request);
    const { id } = await params;
    if (!hrUuid.safeParse(id).success) return error('معرف السلفة غير صالح');
    if (!await findAdvance(auth.companyId, id)) return notFound();
    const { data, error: rpcError } = await getSupabase().rpc('cancel_employee_advance_atomic', {
      p_company_id: auth.companyId,
      p_advance_id: id,
      p_user_id: auth.userId,
    });
    if (rpcError) throw rpcError;
    return success(data);
  } catch (cause) {
    return handleApiError(cause);
  }
}
