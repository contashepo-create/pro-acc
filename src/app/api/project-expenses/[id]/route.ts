import { NextRequest } from 'next/server';
import { success, error, parseBody, requireModulePermission, handleApiError } from '@/lib/api-helpers';
import { getSupabase } from '@/lib/supabase-client';
import { deliveryUuid, projectExpenseUpdateSchema } from '@/lib/project-delivery-validation';

async function findExpense(companyId: string, id: string) {
  const { data, error: queryError } = await getSupabase().from('project_expenses')
    .select('id,project_id,expense_type,description,amount,date,contact_id,journal_entry_id,status,approved_by,approved_at,notes,created_at,updated_at,projects(name),contacts(name),users(name)')
    .eq('id', id).eq('company_id', companyId).maybeSingle();
  if (queryError) throw queryError;
  return data;
}

export async function GET(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const auth = await requireModulePermission(req, 'projects', 'read');
    const { id } = await params;
    if (!deliveryUuid.safeParse(id).success) return error('معرف المصروف غير صالح');
    const expense = await findExpense(auth.companyId, id);
    return expense ? success(expense) : error('المصروف غير موجود', 404);
  } catch (cause) {
    return handleApiError(cause);
  }
}

export async function PUT(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const auth = await requireModulePermission(req, 'projects', 'update');
    const { id } = await params;
    if (!deliveryUuid.safeParse(id).success) return error('معرف المصروف غير صالح');
    const parsed = projectExpenseUpdateSchema.safeParse(await parseBody(req));
    if (!parsed.success) return error(parsed.error.issues[0]?.message || 'لا يُسمح إلا بتعديل الملاحظات');
    if (!await findExpense(auth.companyId, id)) return error('المصروف غير موجود', 404);
    const { data, error: rpcError } = await getSupabase().rpc('update_project_expense_note_atomic', {
      p_company_id: auth.companyId, p_expense_id: id, p_notes: parsed.data.notes || '', p_user_id: auth.userId,
    });
    if (rpcError) throw rpcError;
    return success(data);
  } catch (cause) {
    return handleApiError(cause);
  }
}

export async function DELETE(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const auth = await requireModulePermission(req, 'projects', 'delete');
    const { id } = await params;
    if (!deliveryUuid.safeParse(id).success) return error('معرف المصروف غير صالح');
    if (!await findExpense(auth.companyId, id)) return error('المصروف غير موجود', 404);
    const { data, error: rpcError } = await getSupabase().rpc('cancel_project_expense', {
      p_company_id: auth.companyId, p_expense_id: id, p_user_id: auth.userId,
    });
    if (rpcError) throw rpcError;
    return success(data);
  } catch (cause) {
    return handleApiError(cause);
  }
}
