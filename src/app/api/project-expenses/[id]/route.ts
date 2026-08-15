import { NextRequest } from 'next/server';
import { success, error, notFound, parseBody, requireApiAuth, handleApiError, requireModulePermission } from '@/lib/api-helpers';
import { getSupabase } from '@/lib/supabase-client';
import { PROJECT_EXPENSE_CODES } from '@/lib/constants';

const sb = () => getSupabase();

export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const auth = await requireModulePermission(req, 'projects', 'read');
    const { id } = await params;
    const s = sb();

    const { data: expense, error: queryErr } = await s.from('project_expenses')
      .select('*, projects(name), contacts(name)')
      .eq('id', id)
      .eq('company_id', auth.companyId)
      .maybeSingle();

    if (queryErr) throw queryErr;
    if (!expense) return notFound();

    const result = expense as Record<string, any>;
    result.project_name = result.projects?.name || null;
    result.contact_name = result.contacts?.name || null;

    return success(result);
  } catch (err) {
    return handleApiError(err);
  }
}

export async function PUT(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const auth = await requireModulePermission(req, 'projects', 'update');
    const { id } = await params;
    const s = sb();
    const body = await parseBody(req);

    const { data: existing } = await s.from('project_expenses')
      .select('*')
      .eq('id', id)
      .eq('company_id', auth.companyId)
      .maybeSingle();

    if (!existing) return notFound();

    const oldExpense = existing as any;
    if (oldExpense.journal_entry_id && Object.keys(body).some((field) => field!=='notes')) {
      return error('لا يمكن تعديل بيانات مصروف مرحّل؛ ألغِه بقيد عكسي وأنشئ مصروفاً جديداً', 409);
    }
    if (body.notes!==undefined && (typeof body.notes!=='string' || body.notes.length>2000)) return error('الملاحظات غير صالحة');
    if (body.amount !== undefined && (!Number.isFinite(Number(body.amount)) || Number(body.amount) <= 0 || Math.abs(Number(body.amount) * 100 - Math.round(Number(body.amount) * 100)) > 1e-8)) return error('المبلغ غير صالح');
    if (body.date !== undefined && !Number.isFinite(Date.parse(body.date))) return error('التاريخ غير صالح');
    if (body.contact_id) {
      const { data: contact } = await s.from('contacts').select('id')
        .eq('id', body.contact_id).eq('company_id', auth.companyId).maybeSingle();
      if (!contact) return error('الطرف غير موجود', 404);
    }
    const updateData: any = {};

    if (body.description !== undefined) updateData.description = body.description;
    if (body.amount !== undefined) updateData.amount = body.amount;
    if (body.date !== undefined) updateData.date = body.date;
    if (body.contact_id !== undefined) updateData.contact_id = body.contact_id;
    if (body.notes !== undefined) updateData.notes = body.notes;

    if (body.expense_type !== undefined) {
      if (!PROJECT_EXPENSE_CODES[body.expense_type]) return error('نوع المصروف غير صالح');
      updateData.expense_type = body.expense_type;
      updateData.account_code = PROJECT_EXPENSE_CODES[body.expense_type];
    }
    if (Object.keys(updateData).length===0) return error('لا توجد حقول صالحة للتعديل');

    const { data: updated, error: updateErr } = await s.from('project_expenses')
      .update(updateData)
      .eq('id', id).eq('company_id', auth.companyId)
      .select('*')
      .single();

    if (updateErr) throw updateErr;

    return success(updated);
  } catch (err) {
    return handleApiError(err);
  }
}

export async function DELETE(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const auth = await requireModulePermission(req, 'projects', 'delete');
    const { id } = await params;
    const s = sb();

    const { data: existing } = await s.from('project_expenses')
      .select('*')
      .eq('id', id)
      .eq('company_id', auth.companyId)
      .maybeSingle();

    if (!existing) return notFound();

    const expense = existing as any;

    if (expense.status === 'rejected') return error('المصروف ملغى بالفعل', 409);
    if (expense.journal_entry_id) {
      const { data: cancelled, error: rpcErr } = await s.rpc('cancel_project_expense', {
        p_company_id: auth.companyId,
        p_expense_id: id,
        p_user_id: auth.userId,
      });
      if (rpcErr) throw rpcErr;
      return success(cancelled);
    }

    if (expense.status !== 'draft') return error('لا يمكن حذف مصروف دخل دورة الموافقة', 409);
    const { error: deleteError } = await s.from('project_expenses').delete()
      .eq('id', id).eq('company_id', auth.companyId).eq('status', 'draft');
    if (deleteError) throw deleteError;
    return success({ deleted: true });
  } catch (err) {
    return handleApiError(err);
  }
}
